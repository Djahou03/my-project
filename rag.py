from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import logging
from typing import Dict, Any

from langchain.docstore.document import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.chains import RetrievalQA
from langchain_community.llms import CTransformers

# Cache du tokenizer et du modèle M2M100
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from langdetect import detect, DetectorFactory
DetectorFactory.seed = 0  # pour résultats déterministes

from transformers import PreTrainedTokenizer
from typing import List

# Configuration des logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="PDF RAG API", version="1.0.0")

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Répertoires
TMP_TEXT_DIR = "tmp_texts"
PERSIST_DIR = "vectorstore"
os.makedirs(TMP_TEXT_DIR, exist_ok=True)
os.makedirs(PERSIST_DIR, exist_ok=True)

# Modèles Pydantic
class IngestRequest(BaseModel):
    text: str
    pdf_id: str

class QuestionRequest(BaseModel):
    question: str
    pdf_id: str

# Variables globales pour les modèles (pour éviter le rechargement)
embeddings_model = None
llm_model = None

def get_embeddings():
    """Initialise et retourne le modèle d'embeddings"""
    global embeddings_model
    if embeddings_model is None:
        try:
            embeddings_model = HuggingFaceEmbeddings(
                model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
            )
            logger.info("Modèle d'embeddings chargé avec succès")
        except Exception as e:
            logger.error(f"Erreur lors du chargement du modèle d'embeddings: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors du chargement du modèle d'embeddings")
    return embeddings_model

def get_llm():
    """Initialise et retourne le modèle LLM"""
    global llm_model
    if llm_model is None:
        try:
            llm_model = CTransformers(
                model="TheBloke/Mistral-7B-Instruct-v0.1-GGUF",
                model_file="mistral-7b-instruct-v0.1.Q4_K_M.gguf",
                model_type="mistral",
                config={
                    "max_new_tokens": 512,
                    "temperature": 0.7,
                    "context_length": 4096
                },
            )
            logger.info("Modèle LLM chargé avec succès")
        except Exception as e:
            logger.error(f"Erreur lors du chargement du modèle LLM: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors du chargement du modèle LLM")
    return llm_model

@app.get("/")
def root():
    """Point d'entrée de base pour vérifier que l'API fonctionne"""
    return {"message": "PDF RAG API is running", "status": "ok"}

@app.get("/health")
def health_check():
    """Endpoint de vérification de santé"""
    try:
        # Vérifier que les répertoires existent
        dirs_ok = os.path.exists(TMP_TEXT_DIR) and os.path.exists(PERSIST_DIR)
        return {
            "status": "healthy",
            "directories": dirs_ok,
            "tmp_dir": TMP_TEXT_DIR,
            "persist_dir": PERSIST_DIR
        }
    except Exception as e:
        logger.error(f"Erreur lors du health check: {e}")
        raise HTTPException(status_code=500, detail="Service non disponible")

@app.post("/ingest_text")
def ingest_text(request: IngestRequest) -> Dict[str, Any]:
    """Ingestion du texte PDF avec gestion d'erreurs robuste"""
    try:
        # Validation des données
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Le texte ne peut pas être vide")
        
        if not request.pdf_id or not request.pdf_id.strip():
            raise HTTPException(status_code=400, detail="L'ID du PDF ne peut pas être vide")
        
        # Nettoyage du nom de fichier pour éviter les problèmes
        safe_pdf_id = "".join(c for c in request.pdf_id if c.isalnum() or c in (' ', '-', '_', '.')).rstrip()
        
        logger.info(f"Début de l'ingestion pour: {safe_pdf_id}")
        
        # Sauvegarde du texte
        text_path = os.path.join(TMP_TEXT_DIR, f"{safe_pdf_id}.txt")
        try:
            with open(text_path, "w", encoding="utf-8") as f:
                f.write(request.text)
            logger.info(f"Texte sauvegardé dans: {text_path}")
        except Exception as e:
            logger.error(f"Erreur lors de la sauvegarde du texte: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde du texte")
        
        # Lecture et création des documents
        try:
            with open(text_path, "r", encoding="utf-8") as f:
                raw_text = f.read()
            
            if not raw_text.strip():
                raise HTTPException(status_code=400, detail="Le texte extrait est vide")
            
            docs = [Document(page_content=raw_text, metadata={"source": safe_pdf_id})]
            logger.info(f"Document créé avec {len(raw_text)} caractères")
        except Exception as e:
            logger.error(f"Erreur lors de la lecture du fichier: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors de la lecture du fichier")
        
        # Découpage du texte
        try:
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=500,
                chunk_overlap=100,
                length_function=len,
                separators=["\n\n", "\n", " ", ""]
            )
            chunks = splitter.split_documents(docs)
            logger.info(f"Texte découpé en {len(chunks)} chunks")
            
            if not chunks:
                raise HTTPException(status_code=400, detail="Aucun chunk créé à partir du texte")
        except Exception as e:
            logger.error(f"Erreur lors du découpage du texte: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors du découpage du texte")
        
        # Création du vectorstore
        try:
            embeddings = get_embeddings()
            store = FAISS.from_documents(chunks, embedding=embeddings)
            
            # Sauvegarde du vectorstore
            vectorstore_path = os.path.join(PERSIST_DIR, safe_pdf_id)
            store.save_local(vectorstore_path)
            logger.info(f"Vectorstore sauvegardé dans: {vectorstore_path}")
            
        except Exception as e:
            logger.error(f"Erreur lors de la création du vectorstore: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors de la création du vectorstore")
        
        # Nettoyage du fichier temporaire
        try:
            os.remove(text_path)
            logger.info("Fichier temporaire supprimé")
        except Exception as e:
            logger.warning(f"Impossible de supprimer le fichier temporaire: {e}")
        
        return {
            "status": "success",
            "message": f"PDF '{safe_pdf_id}' ingéré avec succès",
            "chunks_created": len(chunks),
            "pdf_id": safe_pdf_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur inattendue lors de l'ingestion: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur inattendue: {str(e)}")

@app.post("/chat")
def chat(request: QuestionRequest) -> Dict[str, Any]:
    """Chat avec le PDF ingéré"""
    try:
        # Validation des données
        if not request.question or not request.question.strip():
            raise HTTPException(status_code=400, detail="La question ne peut pas être vide")
        
        if not request.pdf_id or not request.pdf_id.strip():
            raise HTTPException(status_code=400, detail="L'ID du PDF ne peut pas être vide")
        
        # Nettoyage du nom de fichier
        safe_pdf_id = "".join(c for c in request.pdf_id if c.isalnum() or c in (' ', '-', '_', '.')).rstrip()
        
        logger.info(f"Question reçue pour {safe_pdf_id}: {request.question}")
        
        # Vérification de l'existence du vectorstore
        vectorstore_path = os.path.join(PERSIST_DIR, safe_pdf_id)
        if not os.path.exists(vectorstore_path):
            raise HTTPException(
                status_code=404, 
                detail=f"PDF '{safe_pdf_id}' non trouvé. Veuillez d'abord l'ingérer."
            )
        
        # Chargement du vectorstore
        try:
            embeddings = get_embeddings()
            store = FAISS.load_local(
                vectorstore_path, 
                embeddings, 
                allow_dangerous_deserialization=True
            )
            retriever = store.as_retriever(search_kwargs={"k": 5})
            logger.info("Vectorstore chargé avec succès")
        except Exception as e:
            logger.error(f"Erreur lors du chargement du vectorstore: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors du chargement du vectorstore")
        
        # Chargement du modèle LLM
        try:
            llm = get_llm()
            logger.info("Modèle LLM chargé avec succès")
        except Exception as e:
            logger.error(f"Erreur lors du chargement du LLM: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors du chargement du modèle LLM")
        
        # Création de la chaîne QA
        try:
            qa_chain = RetrievalQA.from_chain_type(
                llm=llm,
                chain_type="stuff",
                retriever=retriever,
                return_source_documents=False
            )
            
            # Exécution de la question
            answer = qa_chain.run(request.question)
            
            logger.info("Question traitée avec succès")
            
            return {
                "status": "success",
                "answer": answer,
                "pdf_id": safe_pdf_id,
                "question": request.question
            }
            
        except Exception as e:
            logger.error(f"Erreur lors de l'exécution de la chaîne QA: {e}")
            raise HTTPException(status_code=500, detail="Erreur lors du traitement de la question")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur inattendue lors du chat: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur inattendue: {str(e)}")

@app.get("/pdfs")
def list_pdfs():
    """Liste tous les PDFs ingérés"""
    try:
        if not os.path.exists(PERSIST_DIR):
            return {"pdfs": []}
        
        pdfs = []
        for item in os.listdir(PERSIST_DIR):
            item_path = os.path.join(PERSIST_DIR, item)
            if os.path.isdir(item_path):
                pdfs.append({
                    "pdf_id": item,
                    "path": item_path,
                    "exists": True
                })
        
        return {"pdfs": pdfs, "count": len(pdfs)}
    
    except Exception as e:
        logger.error(f"Erreur lors de la liste des PDFs: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de la récupération de la liste des PDFs")




def chunk_text_by_token_limit(text: str, tokenizer: PreTrainedTokenizer, max_tokens: int = 800) -> List[str]:
    """
    Découpe le texte brut en morceaux de max_tokens (en jetons) sans couper au milieu d'une phrase.
    """
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    chunks = []
    current_chunk = ""

    for sentence in sentences:
        temp_chunk = current_chunk + " " + sentence if current_chunk else sentence
        num_tokens = len(tokenizer.tokenize(temp_chunk))
        if num_tokens <= max_tokens:
            current_chunk = temp_chunk
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence  # Commencer un nouveau chunk

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks






# Définis un schéma pour la requête de traduction
class TranslationRequest(BaseModel):
    source_text: str
    source_lang: str
    target_lang: str



tokenizer_m2m = None
model_m2m = None

def get_m2m_model():
    global tokenizer_m2m, model_m2m
    if tokenizer_m2m is None or model_m2m is None:
        tokenizer_m2m = M2M100Tokenizer.from_pretrained("facebook/m2m100_418M")
        model_m2m     = M2M100ForConditionalGeneration.from_pretrained("facebook/m2m100_418M")
    return tokenizer_m2m, model_m2m

@app.post("/translate")
def translate_text(request: TranslationRequest):
    try:
        text = request.source_text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Le texte source est vide")
        tgt = request.target_lang.strip()
        if not tgt:
            raise HTTPException(status_code=400, detail="La langue cible est vide")

        # Détection automatique
        src = request.source_lang
        if src.lower() == "auto":
            try:
                src = detect(text)
                logger.info(f"Langue détectée automatiquement : {src}")
            except Exception as e:
                logger.warning(f"Échec détection, fallback sur 'en' : {e}")
                src = "en"

        tokenizer, model = get_m2m_model()
        tokenizer.src_lang = src
        model.config.forced_bos_token_id = tokenizer.get_lang_id(tgt)

        # 1. Découper le texte en chunks de taille supportée
        chunks = chunk_text_by_token_limit(text, tokenizer, max_tokens=800)

        # 2. Traduire chaque chunk
        translated_chunks = []
        for chunk in chunks:
            encoded = tokenizer(chunk, return_tensors="pt", truncation=True)
            generated_tokens = model.generate(
                **encoded,
                max_new_tokens=512,
                num_beams=5,
                no_repeat_ngram_size=3
            )
            translated = tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)[0]
            translated_chunks.append(translated)

        # 3. Reconstituer le texte complet
        full_translation = "\n".join(translated_chunks)

        return {"translated_text": full_translation}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Erreur lors de /translate :", exc_info=True)
        return PlainTextResponse(str(e), status_code=500)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
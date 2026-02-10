import React, { useState, useEffect, useRef } from 'react';
import pdfToText from 'react-pdftotext';
import '../styles/Zeb.css';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faUpload, faFilePdf, faPlay, faPause, faStop, faVolumeUp, faVolumeDown, faForward, faHighlighter, faStickyNote, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { openDB } from 'idb';
import { API_URL } from "../config";
import TextTo from './TextTo'; 


// Configuration d'IndexedDB avec gestion d'erreurs
const dbPromise = openDB('pdf-reader', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('pdfs')) {
      db.createObjectStore('pdfs', { keyPath: 'name' });
    }
  },
});

const Chargement = ({ onSelectPdf }) => {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [extracts, setExtracts] = useState({});
  const [highlight, setHighlight] = useState(0);
  const [selectedText, setSelectedText] = useState(null);
  const [showButtons, setShowButtons] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState({ top: 10, left: 0 });
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [note, setNote] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [translatedText, setTranslatedText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false); // État pour le traitement
  const [processingFile, setProcessingFile] = useState(null); // Fichier en cours de traitement
  const [isTranslating, setIsTranslating] = useState(false); // État pour la traduction
  const textareaRef = useRef(null);
  
  const languages = [
    { name: 'Anglais', code: 'en' },
    { name: 'Français', code: 'fr' },
    { name: 'Fon', code: 'fon' },
    { name: 'Yoruba', code: 'yo' },
    { name: 'Español', code: 'es' },
    { name: 'Deutsch', code: 'de' },
    { name: 'Italiano', code: 'it' },
    { name: 'Português', code: 'pt' },
    { name: 'Chinois', code: 'zh' },
    { name: 'Japonais', code: 'ja' },
  ];

  // Fonction pour gérer la sélection et le chargement des fichiers
  const handleFileChange = async (e) => {
    const newFiles = Array.from(e.target.files);
    const validFiles = newFiles.filter(file => {
      // Vérification plus stricte du type de fichier
      const isValidType = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isValidSize = file.size > 0 && file.size < 50 * 1024 * 1024; // Limite à 50MB
      
      if (!isValidType) {
        alert(`Le fichier ${file.name} n'est pas un PDF valide.`);
        return false;
      }
      if (!isValidSize) {
        alert(`Le fichier ${file.name} est trop volumineux (max 50MB).`);
        return false;
      }
      return true;
    });
    
    // Éviter les doublons
    const uniqueFiles = validFiles.filter(newFile => 
      !files.some(existingFile => existingFile.name === newFile.name)
    );
    
    setFiles(prevFiles => [...prevFiles, ...uniqueFiles]);
  };

  // Fonction améliorée pour la sélection et l'ingestion des fichiers
  const handleFileSelect = async (file) => {
    // Vérifier si le fichier est déjà en cours de traitement
    if (processingFile === file.name) {
      alert('Ce fichier est déjà en cours de traitement. Veuillez patienter.');
      return;
    }

    // Vérifier si le texte a déjà été extrait
    if (extracts[file.name]) {
      setSelectedFile(file);
      onSelectPdf(file.name);
      return;
    }

    setIsProcessing(true);
    setProcessingFile(file.name);

    try {
      // Étape 1: Extraction du texte PDF
      console.log(`Début de l'extraction pour: ${file.name}`);
      const raw = await pdfToText(file);
      
      // Vérifier si le texte extrait n'est pas vide
      if (!raw || raw.trim().length === 0) {
        throw new Error('Le PDF semble vide ou ne contient pas de texte extractible.');
      }

      // Étape 2: Formatage du texte
      const formatted = raw.split(/(?<=[.!?])\s+/).join("\n");
      console.log(`Texte extrait: ${formatted.length} caractères`);

      // Étape 3: Sauvegarde locale du texte extrait
      setExtracts(prev => ({ ...prev, [file.name]: formatted }));

      // Étape 4: Envoi vers le backend avec retry
      await sendToBackendWithRetry(formatted, file.name);

      // Étape 5: Sélection du fichier
      setSelectedFile(file);
      onSelectPdf(file.name);
      
      console.log(`Ingestion réussie pour: ${file.name}`);
      
    } catch (error) {
      console.error(`Erreur lors du traitement de ${file.name}:`, error);
      
      // Messages d'erreur plus spécifiques
      let errorMessage = 'Erreur inconnue lors du traitement du PDF.';
      if (error.message.includes('PDF semble vide')) {
        errorMessage = 'Le PDF semble vide ou ne contient pas de texte extractible.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Erreur de connexion au serveur. Vérifiez votre connexion internet.';
      } else if (error.message.includes('500')) {
        errorMessage = 'Erreur serveur. Le serveur backend ne répond pas correctement.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Données invalides envoyées au serveur.';
      }
      
      alert(`Impossible de traiter le PDF "${file.name}": ${errorMessage}`);
      
      // Supprimer le fichier défaillant de la liste
      setFiles(prev => prev.filter(f => f.name !== file.name));
      
    } finally {
      setIsProcessing(false);
      setProcessingFile(null);
    }
  };

  // Fonction pour envoyer les données au backend avec retry
  const sendToBackendWithRetry = async (text, fileName, maxRetries = 3) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Tentative ${attempt}/${maxRetries} d'envoi vers le backend`);
        console.log(`URL cible: ${API_URL}/ingest_text`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // Timeout de 60 secondes
        
        const response = await fetch(`${API_URL}/ingest_text`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ 
            text: text, 
            pdf_id: fileName 
          }),
          mode: 'cors',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Erreur ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Réponse du serveur:', result);
        return result;
        
      } catch (error) {
        lastError = error;
        console.error(`Tentative ${attempt} échouée:`, error.message, error.name);
        
        // Check if it's an abort/timeout error
        if (error.name === 'AbortError') {
          lastError = new Error('Timeout lors de la connexion au serveur. Vérifiez que le serveur backend est accessible.');
        }
        
        if (attempt < maxRetries) {
          // Attendre avant la prochaine tentative (backoff exponentiel)
          const delayMs = 2000 * Math.pow(2, attempt - 1);
          console.log(`Attente de ${delayMs}ms avant la tentative ${attempt + 1}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    throw lastError;
  };

  // Fonction pour supprimer un fichier
  const handleDelete = async (file) => {
    try {
      // Arrêter la synthèse vocale si active
      window.speechSynthesis.cancel();
      
      // Supprimer de la liste des fichiers
      setFiles(prev => prev.filter(f => f !== file));
      
      // Supprimer le texte extrait
      setExtracts(prev => {
        const newExtracts = { ...prev };
        delete newExtracts[file.name];
        return newExtracts;
      });
      
      // Réinitialiser l'état si c'est le fichier sélectionné
      if (selectedFile?.name === file.name) {
        setSelectedFile(null);
        onSelectPdf?.(null);
      }
      
      // Réinitialiser les autres états
      setShowButtons(false);
      setShowNoteInput(false);
      setSelectedText(null);
      
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
    }
  };

  // Fonctions pour IndexedDB avec gestion d'erreurs
  const saveReadingPosition = async (fileName, position) => {
    try {
      const db = await dbPromise;
      await db.put('pdfs', { name: fileName, position });
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la position:', error);
    }
  };

  const loadReadingPosition = async (fileName) => {
    try {
      const db = await dbPromise;
      const record = await db.get('pdfs', fileName);
      return record ? record.position : 0;
    } catch (error) {
      console.error('Erreur lors du chargement de la position:', error);
      return 0;
    }
  };

  // Fonction pour détecter et afficher la sélection du texte
  const handleTextSelect = () => {
    const selection = window.getSelection();
    const selText = selection.toString();
    
    if (selText && textareaRef.current) {
      const textarea = textareaRef.current;
      const rect = textarea.getBoundingClientRect();
      
      setSelectionPosition({
        top: rect.top - 50,
        left: rect.left + 10,
      });
      setSelectedText(selText);
      setShowButtons(true);
    } else {
      setShowButtons(false);
    }
  };

  // Fonction pour surligner le texte sélectionné
  const handleHighlight = () => {
    if (selectedText && selectedFile && extracts[selectedFile.name]) {
      const updatedText = extracts[selectedFile.name].replace(
        selectedText,
        `<mark>${selectedText}</mark>`
      );
      setExtracts(prevExtracts => ({
        ...prevExtracts,
        [selectedFile.name]: updatedText,
      }));
      setShowButtons(false);
    }
  };

  // Fonction pour afficher l'input pour ajouter une note
  const handleAddNote = () => {
    setShowNoteInput(true);
  };

  // Fonction pour sauvegarder la note dans le texte
  const handleSaveNote = () => {
    if (selectedText && note.trim() && selectedFile && extracts[selectedFile.name]) {
      const updatedText = extracts[selectedFile.name].replace(
        selectedText,
        `${selectedText} [Note: ${note.trim()}]`
      );
      setExtracts(prevExtracts => ({
        ...prevExtracts,
        [selectedFile.name]: updatedText,
      }));
      setNote('');
      setShowNoteInput(false);
      setShowButtons(false);
    }
  };

  /* Fonction améliorée pour la traduction
  const handleTranslate = async () => {
    if (!selectedFile || isTranslating) return;
    
    const textToTranslate = extracts[selectedFile.name] || '';
    if (!textToTranslate.trim()) {
      alert('Aucun texte à traduire.');
      return;
    }

    setIsTranslating(true);

    try {
      const response = await fetch(
        `https://translator-api.glosbe.com/translateByLangDetect?sourceLang=auto&targetLang=${targetLang}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: textToTranslate,
        }
      );

      if (!response.ok) {
        throw new Error(`Erreur de traduction: ${response.status}`);
      }

      const result = await response.json();
      const translatedText = result.translation;
      
      if (translatedText) {
        setTranslatedText(translatedText);
        setExtracts(prevExtracts => ({
          ...prevExtracts,
          [selectedFile.name]: translatedText,
        }));
      } else {
        throw new Error('Traduction vide reçue');
      }
      
    } catch (error) {
      console.error("Erreur lors de la traduction:", error);
      alert("Erreur lors de la traduction. Veuillez réessayer.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTargetLangChange = (e) => {
    setTargetLang(e.target.value);
  };*/

  const handleTranslate = async () => {
  if (!selectedFile || isTranslating) return;
  const textToTranslate = extracts[selectedFile.name] || '';
  if (!textToTranslate.trim()) {
    alert('Aucun texte à traduire.');
    return;
  }

  setIsTranslating(true);
  try {
    const response = await fetch(`${API_URL}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", 
        "Accept": "application/json"
      },
      body: JSON.stringify({
        source_text: textToTranslate,
        source_lang: "auto",
        target_lang: targetLang
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Détails de la réponse /translate:", response.status, errBody);
      throw new Error(`Erreur de traduction: ${response.status}`);
    }

    const { translated_text } = await response.json();
    setTranslatedText(translated_text);
    setExtracts(prev => ({
      ...prev,
      [selectedFile.name]: translated_text,
    }));
  } catch (error) {
    console.error("Erreur lors de la traduction:", error);
    alert("Erreur lors de la traduction. Veuillez réessayer.");
  } finally {
    setIsTranslating(false);
  }
};
  const handleTargetLangChange = (e) => {
    setTargetLang(e.target.value);
  };


  
  return (
    <section className="container">
      <section className="control-section">
        <h2>PDF</h2>
        <input 
          type="file" 
          accept="application/pdf,.pdf" 
          multiple 
          onChange={handleFileChange} 
          id="pdf" 
          hidden 
          disabled={isProcessing}
        />
        <label htmlFor="pdf" className={`button choose-file ${isProcessing ? 'disabled' : ''}`}>
          {isProcessing ? (
            <>
              <FontAwesomeIcon icon={faSpinner} spin />
              Traitement en cours...
            </>
          ) : (
            '+ Ajouter des PDF'
          )}
        </label>
        
        {files.length > 0 && (
          <ul className="file-list">
            <h5>PDF CHARGÉS</h5>
            {files.map(file => (
              <li key={file.name} className="file-item">
                <FontAwesomeIcon icon={faFilePdf} className="pdf-icon" />
                <p 
                  className={`file-name ${processingFile === file.name ? 'processing' : ''}`}
                  onClick={() => handleFileSelect(file)}
                  style={{ 
                    cursor: processingFile === file.name ? 'wait' : 'pointer',
                    opacity: processingFile === file.name ? 0.6 : 1
                  }}
                >
                  {file.name}
                  {processingFile === file.name && (
                    <FontAwesomeIcon icon={faSpinner} spin style={{ marginLeft: '10px' }} />
                  )}
                </p>
                <button 
                  onClick={() => handleDelete(file)} 
                  className="button delete-file"
                  disabled={processingFile === file.name}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="content-section">
        <h2 className="contenu">Contenu du PDF</h2>
        <textarea
          ref={textareaRef}
          className="pdf-content"
          value={selectedFile ? (extracts[selectedFile.name] || "") : ""}
          onMouseUp={handleTextSelect}
          readOnly
          placeholder={
            isProcessing 
              ? "Traitement du PDF en cours..." 
              : "Sélectionnez un PDF pour voir son contenu"
          }
        />
        
        {showButtons && (
          <section 
            className="context-buttons"
            style={{
              position: 'absolute',
              top: selectionPosition.top,
              left: selectionPosition.left,
              zIndex: 1000
            }}
          >
            <button onClick={handleHighlight} className="button highlight">
              <FontAwesomeIcon icon={faHighlighter} /> Surligner
            </button>
            <button onClick={handleAddNote} className="button add-note">
              <FontAwesomeIcon icon={faStickyNote} /> Ajouter une note
            </button>
          </section>
        )}
        
        {showNoteInput && (
          <section className="note-input-container">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Entrez votre note"
              className="note-input"
              maxLength={200}
            />
            <button onClick={handleSaveNote} className="button save-note">
              Sauvegarder la note
            </button>
            <button 
              onClick={() => setShowNoteInput(false)} 
              className="button cancel-note"
            >
              Annuler
            </button>
          </section>
        )}
        
        <section className="translation-controls">
          <button 
            onClick={handleTranslate} 
            className="button translate"
            disabled={!selectedFile || isTranslating || !extracts[selectedFile?.name]}
          >
            {isTranslating ? (
              <>
                <FontAwesomeIcon icon={faSpinner} spin />
                Traduction...
              </>
            ) : (
              'Traduire'
            )}
          </button>
          <label>
            en :
            <select 
              value={targetLang} 
              onChange={handleTargetLangChange}
              disabled={isTranslating}
            >
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.name}</option>
              ))}
            </select>
          </label>
        </section>

        <TextTo
          text={selectedFile ? (extracts[selectedFile.name] || '') : ''}
          onHighlight={setHighlight}
          textareaRef={textareaRef}
          file={selectedFile}
          saveReadingPosition={saveReadingPosition}
          loadReadingPosition={loadReadingPosition}
          initialPosition={highlight}
        />
      </section>
    </section>
  );
};
export default Chargement;

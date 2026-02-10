// config.js - Vérifiez cette configuration
export const API_URL = "http://localhost:8000";

// Fonction de test de connexion
export const testConnection = async () => {
  try {
    console.log("Test de connexion vers:", API_URL);
    
    const response = await fetch(`${API_URL}/`, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("Connexion réussie:", data);
    return true;
  } catch (error) {
    console.error("Erreur de connexion:", error);
    return false;
  }
};

// Test de l'endpoint ingest_text
export const testIngestEndpoint = async () => {
  try {
    const testData = {
      text: "Test text",
      pdf_id: "test.pdf"
    };
    
    console.log("Test ingest vers:", `${API_URL}/ingest_text`);
    
    const response = await fetch(`${API_URL}/ingest_text`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log("Test ingest réussi:", result);
    return true;
  } catch (error) {
    console.error("Erreur test ingest:", error);
    return false;
  }
};
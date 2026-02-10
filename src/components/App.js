// src/App.js
import React, { useState } from "react";
import Chargement from "./Chargement";
import ChatWithPDF from "./ChatWithPDF";

function App() {
  const [pdfId, setPdfId] = useState(null);

  return (
    <div>
      <Chargement onSelectPdf={(fileName) => setPdfId(fileName)} />
      {pdfId && <ChatWithPDF pdfId={pdfId} />}
    </div>
  );
}

export default App;


import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faPlay, faPause, faStop, faForward, faBackward, faSpinner 
} from "@fortawesome/free-solid-svg-icons";
// Composant TextTo amélioré
const TextTo = ({ text, onHighlight, textareaRef, file, saveReadingPosition, loadReadingPosition }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [voice, setVoice] = useState(null);
  const [voices, setVoices] = useState([]);
  const [pitch, setPitch] = useState(1);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [savedPosition, setSavedPosition] = useState(0);
  const [progress, setProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const availableVoices = synth.getVoices();
      setVoices(availableVoices);
      if (availableVoices.length > 0 && !voice) {
        // Chercher une voix française en priorité
        const frenchVoice = availableVoices.find(v => v.lang.includes('fr'));
        setVoice(frenchVoice || availableVoices[0]);
      }
    };

    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }

    loadVoices();

    return () => {
      synth.cancel();
    };
  }, [voice]);

  useEffect(() => {
    // Arrêter la lecture lors du changement de texte
    const synth = window.speechSynthesis;
    synth.cancel();
    setCurrentCharIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
    setProgress(0);
  }, [text]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handlePlay = async () => {
    if (!file) {
      alert("Aucun fichier sélectionné");
      return;
    }

    if (!text.trim()) {
      alert("Aucun texte à lire");
      return;
    }

    const synth = window.speechSynthesis;

    if (isPaused) {
      synth.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      synth.cancel();

      try {
        const loadedPosition = await loadReadingPosition(file.name);
        const startPosition = Math.max(loadedPosition || 0, currentCharIndex || 0);
        setSavedPosition(startPosition);

        const utterance = new SpeechSynthesisUtterance(text.slice(startPosition));
        
        if (!voice) {
          alert("Aucune voix disponible");
          return;
        }

        utterance.voice = voice;
        utterance.pitch = pitch;
        utterance.rate = rate;
        utterance.volume = volume;

        const estimatedTime = (text.length / rate) * 0.06;
        setTotalTime(estimatedTime);
        setRemainingTime(estimatedTime);

        utterance.addEventListener("boundary", (event) => {
          const charIndex = startPosition + event.charIndex;
          setCurrentCharIndex(charIndex);
          onHighlight(charIndex);

          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(charIndex, charIndex);
            textareaRef.current.focus();

            const lines = text.split('\n');
            const lineHeight = textareaRef.current.scrollHeight / lines.length;
            const currentLine = text.slice(0, charIndex).split('\n').length - 1;
            textareaRef.current.scrollTop = lineHeight * currentLine;
          }

          const progressPercentage = (charIndex / text.length) * 100;
          setProgress(progressPercentage);

          const elapsedTime = (charIndex / text.length) * estimatedTime;
          setRemainingTime(estimatedTime - elapsedTime);
        });

        utterance.addEventListener("end", () => {
          setIsPaused(false);
          setIsPlaying(false);
          onHighlight(0);
          setCurrentCharIndex(0);
          saveReadingPosition(file.name, 0);
          setProgress(0);
          setRemainingTime(estimatedTime);
        });

        utterance.addEventListener("error", (event) => {
          console.error("Erreur de synthèse vocale:", event.error);
          setIsPlaying(false);
          setIsPaused(false);
        });

        synth.speak(utterance);
        setIsPaused(false);
        setIsPlaying(true);
        
      } catch (error) {
        console.error("Erreur lors de la lecture:", error);
        alert("Erreur lors de la lecture du texte");
      }
    }

    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handlePause = () => {
    const synth = window.speechSynthesis;
    synth.pause();
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleStop = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    setIsPaused(false);
    setIsPlaying(false);
    onHighlight(0);
    
    if (file && textareaRef.current) {
      saveReadingPosition(file.name, currentCharIndex);
      setProgress(0);
      setRemainingTime(totalTime);
    }
  };

  const handleVoiceChange = (event) => {
    const selectedVoice = voices.find((v) => v.name === event.target.value);
    setVoice(selectedVoice);
  };

  const handlePitchChange = (event) => {
    setPitch(parseFloat(event.target.value));
  };

  const handleRateChange = (event) => {
    setRate(parseFloat(event.target.value));
  };

  const handleVolumeChange = (event) => {
    setVolume(parseFloat(event.target.value));
  };

  return (
    <section className="controls">
      <label>
        Voix:
        <select value={voice?.name || ''} onChange={handleVoiceChange}>
          {voices.map((voice) => (
            <option key={voice.name} value={voice.name}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </label>

      <section className="button-group">
        <button 
          className="play" 
          onClick={handlePlay}
          disabled={!text.trim() || !file}
          title="Lecture"
        >
          <FontAwesomeIcon icon={faPlay} />
        </button>
        <button 
          className="pause" 
          onClick={handlePause}
          disabled={!isPlaying}
          title="Pause"
        >
          <FontAwesomeIcon icon={faPause} />
        </button>
        <button 
          className="stop" 
          onClick={handleStop}
          disabled={!isPlaying && !isPaused}
          title="Arrêt"
        >
          <FontAwesomeIcon icon={faStop} />
        </button>
      </section>

      <section className="slider-group">
        <label>
          Volume: {Math.round(volume * 100)}%
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.1" 
            value={volume} 
            onChange={handleVolumeChange} 
          />
        </label>
        <label>
          Pitch: {pitch.toFixed(1)}
          <input 
            type="range" 
            min="0.5" 
            max="2" 
            step="0.1" 
            value={pitch} 
            onChange={handlePitchChange} 
          />
        </label>
        <label>
          Vitesse: {rate.toFixed(1)}x
          <input 
            type="range" 
            min="0.5" 
            max="2" 
            step="0.1" 
            value={rate} 
            onChange={handleRateChange} 
          />
        </label>
      </section>

      <section className="progress-group">
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>
        <p className='para'>
          Temps restant : {formatTime(remainingTime)}
          {isPlaying && " (En cours de lecture)"}
          {isPaused && " (En pause)"}
        </p>
      </section>
    </section>
  );
};

export default TextTo;
















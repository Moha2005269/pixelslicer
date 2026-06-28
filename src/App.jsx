import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { 
  Image as ImageIcon, Scissors, Play, Pause, Settings2, Download, UploadCloud, 
  Move, ChevronRight, HelpCircle, Copy, Check, BookOpen, X, Plus, Trash2, 
  Volume2, VolumeX, Volume1, ZoomIn, ZoomOut, RotateCcw, Wand2, Grid, 
  CopyPlus, ArrowUp, ArrowDown, Sliders, Info, FileSpreadsheet
} from 'lucide-react';
import confetti from 'canvas-confetti';
import JSZip from 'jszip';

// Helper component to render a crisp thumbnail of a single slice
function SliceThumbnail({ image, slice }) {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !slice) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 48;
    canvas.height = 48;
    ctx.clearRect(0, 0, 48, 48);
    
    // Draw transparent chessboard grid
    const sz = 4;
    for (let x = 0; x < 48; x += sz * 2) {
      for (let y = 0; y < 48; y += sz * 2) {
        ctx.fillStyle = '#fdfbf7';
        ctx.fillRect(x, y, sz, sz);
        ctx.fillRect(x + sz, y + sz, sz, sz);
        ctx.fillStyle = '#e2d8c3';
        ctx.fillRect(x + sz, y, sz, sz);
        ctx.fillRect(x, y + sz, sz, sz);
      }
    }
    
    ctx.imageSmoothingEnabled = false;
    
    // Scale and center the sprite
    const scale = Math.min(38 / slice.w, 38 / slice.h);
    const dx = (48 - slice.w * scale) / 2;
    const dy = (48 - slice.h * scale) / 2;
    
    try {
      ctx.drawImage(
        image,
        Math.max(0, Math.floor(slice.x)),
        Math.max(0, Math.floor(slice.y)),
        Math.max(1, Math.floor(slice.w)),
        Math.max(1, Math.floor(slice.h)),
        dx,
        dy,
        slice.w * scale,
        slice.h * scale
      );
    } catch (e) {
      // Catch drawing out of bounds
    }
  }, [image, slice]);
  
  return (
    <canvas 
      ref={canvasRef} 
      className="w-12 h-12 rounded border border-[#a67c52] bg-[#fdfbf7] pixelated shadow-sm shrink-0" 
    />
  );
}

export default function App() {
  // --- States ---
  const [image, setImage] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [slices, setSlices] = useState([]);
  const [activeSliceId, setActiveSliceId] = useState(null);
  
  // Canvas Viewport States
  const [zoom, setZoom] = useState(2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [showSlicesGrid, setShowSlicesGrid] = useState(true);
  
  // Grid Slicing Configuration
  const [numCols, setNumCols] = useState(5);
  const [numRows, setNumRows] = useState(1);
  const [gridWidth, setGridWidth] = useState(0);
  const [gridHeight, setGridHeight] = useState(0);
  const [gridOffsetX, setGridOffsetX] = useState(0);
  const [gridOffsetY, setGridOffsetY] = useState(0);
  const [gridGapX, setGridGapX] = useState(0);
  const [gridGapY, setGridGapY] = useState(0);
  
  // Animation / Preview States
  const [isPlaying, setIsPlaying] = useState(true);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [playbackMode, setPlaybackMode] = useState('loop'); // 'loop' or 'bounce'
  const [frameDelay, setFrameDelay] = useState(150); // Default speed in ms
  
  // Exporter Settings
  const [exportFormat, setExportFormat] = useState('gif'); // 'gif', 'zip', 'atlas'
  const [exportScale, setExportScale] = useState(4); // 1x, 2x, 4x, 8x for crisp pixel art
  const [bgColor, setBgColor] = useState('transparent'); // hex value or 'transparent'
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultGif, setResultGif] = useState(null);
  const [gifJsLoaded, setGifJsLoaded] = useState(false);
  const [isChopping, setIsChopping] = useState(false);
  
  // Volume state
  const [volume, setVolume] = useState(() => {
    const val = localStorage.getItem('pixelslicer_volume');
    return val !== null ? parseFloat(val) : 0.5;
  });
  
  // Tutorial Modal
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [isPromptCopied, setIsPromptCopied] = useState(false);
  
  // Upload drag State
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // --- Refs ---
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const processingCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const dragState = useRef({ isDragging: false, action: null });
  const isSpacePressed = useRef(false);
  const previewDirection = useRef(1);

  // --- Audio Engine (Web Audio Synth) ---
  const playSound = useCallback((type) => {
    if (volume === 0) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(volume * 0.4, ctx.currentTime);
      masterGain.connect(ctx.destination);

      if (type === 'click') {
        // Satisfying woody click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(750, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'chop') {
        // Heavy, satisfying thud for slicing
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(140, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'tada') {
        // Joyful, musical folk-like major arpeggio
        const chord = [392.00, 493.88, 587.33, 783.99]; // G4, B4, D5, G5
        chord.forEach((freq, idx) => {
          setTimeout(() => {
            if (ctx.state === 'closed') return;
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            oscGain.gain.setValueAtTime(0.25, ctx.currentTime);
            oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
            osc.connect(oscGain);
            oscGain.connect(masterGain);
            osc.start();
            osc.stop(ctx.currentTime + 0.45);
          }, idx * 80);
        });
      } else if (type === 'page') {
        // Soft rustle (noise sweep)
        const bufferSize = ctx.sampleRate * 0.12; 
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.12);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        noise.start();
      } else if (type === 'copy') {
        // High crystal chime
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1350, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } else if (type === 'trash') {
        // Sliding pitch downwards
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === 'zoom') {
        // Quick high-pitch slide
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch(e) {
      console.warn("Audio Context failed: ", e);
    }
  }, [volume]);

  // Persist volume settings
  useEffect(() => {
    localStorage.setItem('pixelslicer_volume', volume.toString());
  }, [volume]);

  // Load GIF.js scripts
  useEffect(() => {
    if (!window.GIF) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js';
      script.onload = () => setGifJsLoaded(true);
      document.head.appendChild(script);
    } else {
      setGifJsLoaded(true);
    }
  }, []);

  // --- Confetti helper ---
  const triggerConfetti = () => {
    confetti({
      particleCount: 110,
      spread: 75,
      origin: { y: 0.65 },
      colors: ['#a53030', '#a67c52', '#7d9169', '#f0e3cc', '#eeddc5']
    });
  };

  // --- Auto-detect algorithm (connected components search) ---
  const autoDetectSlices = useCallback(() => {
    if (!image) return;
    playSound('click');
    
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, image.width, image.height);
    } catch (e) {
      alert("Security restriction: Could not read image pixels due to Cross-Origin. Try uploading a local file.");
      return;
    }
    
    const data = imgData.data;
    const w = image.width;
    const h = image.height;
    
    // --- Step 1: Detect background color ---
    // Sample pixels from the four corners to determine the most common background color.
    const getPixel = (px, py) => {
      const i = (py * w + px) * 4;
      return [data[i], data[i+1], data[i+2], data[i+3]];
    };
    
    const cornerSamples = [
      getPixel(0, 0),
      getPixel(w - 1, 0),
      getPixel(0, h - 1),
      getPixel(w - 1, h - 1),
      // Also sample a few pixels inward in case corners are clipped
      getPixel(Math.min(1, w - 1), 0),
      getPixel(0, Math.min(1, h - 1)),
    ];
    
    // Find most common corner color
    const colorKey = (c) => `${c[0]},${c[1]},${c[2]},${c[3]}`;
    const colorCounts = {};
    cornerSamples.forEach(c => {
      const k = colorKey(c);
      colorCounts[k] = (colorCounts[k] || 0) + 1;
    });
    
    let bgColorKey = null;
    let bgCount = 0;
    for (const [k, count] of Object.entries(colorCounts)) {
      if (count > bgCount) { bgCount = count; bgColorKey = k; }
    }
    
    const bgColor = bgColorKey ? bgColorKey.split(',').map(Number) : [0, 0, 0, 0];
    const bgIsTransparent = bgColor[3] < 16;
    
    // Color distance tolerance for background matching
    const tolerance = 30;
    
    const isBackground = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return true;
      const idx = (y * w + x) * 4;
      const a = data[idx + 3];
      
      // Fully transparent pixels are always background
      if (a < 8) return true;
      
      // If the detected background is transparent, only alpha matters
      if (bgIsTransparent) return a < 16;
      
      // Otherwise compare RGB distance to background color
      const dr = data[idx] - bgColor[0];
      const dg = data[idx + 1] - bgColor[1];
      const db = data[idx + 2] - bgColor[2];
      return (dr * dr + dg * dg + db * db) < (tolerance * tolerance);
    };
    
    const visited = new Uint8Array(w * h);
    const rects = [];
    
    // Scan all pixels for foreground zones
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (visited[idx] === 0 && !isBackground(x, y)) {
          // Connected Component Search (BFS)
          let minX = x, maxX = x, minY = y, maxY = y;
          const queue = [x, y];
          visited[idx] = 1;
          
          let head = 0;
          while (head < queue.length) {
            const cx = queue[head++];
            const cy = queue[head++];
            
            // Check 8-neighbor directions to handle diagonal details
            const dirs = [
              -1, -1,  0, -1,  1, -1,
              -1,  0,          1,  0,
              -1,  1,  0,  1,  1,  1
            ];
            for (let d = 0; d < 16; d += 2) {
              const nx = cx + dirs[d];
              const ny = cy + dirs[d+1];
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const nIdx = ny * w + nx;
                if (visited[nIdx] === 0 && !isBackground(nx, ny)) {
                  visited[nIdx] = 1;
                  queue.push(nx, ny);
                  if (nx < minX) minX = nx;
                  if (nx > maxX) maxX = nx;
                  if (ny < minY) minY = ny;
                  if (ny > maxY) maxY = ny;
                }
              }
            }
          }
          
          // Filter out tiny artifacts (anything smaller than 4x4)
          const sw = maxX - minX + 1;
          const sh = maxY - minY + 1;
          if (sw >= 4 && sh >= 4) {
            rects.push({ x: minX, y: minY, w: sw, h: sh });
          }
        }
      }
    }
    
    // Group and merge bounding boxes that overlap or are very close (padding = 3px)
    let merged = [...rects];
    let changed = true;
    const gap = 3;
    
    while (changed) {
      changed = false;
      const nextList = [];
      const grouped = new Set();
      
      for (let i = 0; i < merged.length; i++) {
        if (grouped.has(i)) continue;
        let r1 = merged[i];
        
        for (let j = i + 1; j < merged.length; j++) {
          if (grouped.has(j)) continue;
          const r2 = merged[j];
          
          // Intersection check with padding
          const overlap = !(
            r2.x > r1.x + r1.w + gap ||
            r2.x + r2.w + gap < r1.x ||
            r2.y > r1.y + r1.h + gap ||
            r2.y + r2.h + gap < r1.y
          );
          
          if (overlap) {
            const nx1 = Math.min(r1.x, r2.x);
            const ny1 = Math.min(r1.y, r2.y);
            const nx2 = Math.max(r1.x + r1.w, r2.x + r2.w);
            const ny2 = Math.max(r1.y + r1.h, r2.y + r2.h);
            r1 = {
              x: nx1,
              y: ny1,
              w: nx2 - nx1,
              h: ny2 - ny1
            };
            grouped.add(j);
            changed = true;
          }
        }
        nextList.push(r1);
      }
      merged = nextList;
    }
    
    // Sort left-to-right, top-to-bottom
    merged.sort((a, b) => {
      const rowA = Math.floor(a.y / 20);
      const rowB = Math.floor(b.y / 20);
      if (rowA !== rowB) return rowA - rowB;
      return a.x - b.x;
    });
    
    // Map bounding boxes to states
    const finalSlices = merged.map((rect, idx) => ({
      id: `auto_${idx}_${Date.now()}`,
      name: `Frame ${idx + 1}`,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      delay: frameDelay
    }));
    
    if (finalSlices.length === 0) {
      alert("No sprites detected. The image may have a complex background. Try using the Grid Slicer instead.");
      return;
    }
    
    setSlices(finalSlices);
    if (finalSlices.length > 0) {
      setActiveSliceId(finalSlices[0].id);
    }
    playSound('tada');
  }, [image, frameDelay, playSound]);

  // --- Grid Generator ---
  const applyGridSlices = useCallback(() => {
    if (!image) return;
    playSound('chop');
    
    const cols = Math.max(1, numCols);
    const rows = Math.max(1, numRows);
    
    // Auto-divide if custom dimensions are 0
    const cw = gridWidth > 0 ? gridWidth : Math.floor((image.width - gridOffsetX) / cols);
    const ch = gridHeight > 0 ? gridHeight : Math.floor((image.height - gridOffsetY) / rows);
    
    const newSlices = [];
    let counter = 1;
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = gridOffsetX + c * (cw + gridGapX);
        const sy = gridOffsetY + r * (ch + gridGapY);
        
        if (sx < image.width && sy < image.height) {
          newSlices.push({
            id: `grid_${r}_${c}_${Date.now()}_${counter}`,
            name: `Frame ${counter}`,
            x: Math.max(0, Math.round(sx)),
            y: Math.max(0, Math.round(sy)),
            w: Math.max(1, Math.min(image.width - sx, Math.round(cw))),
            h: Math.max(1, Math.min(image.height - sy, Math.round(ch))),
            delay: frameDelay
          });
          counter++;
        }
      }
    }
    
    setSlices(newSlices);
    if (newSlices.length > 0) {
      setActiveSliceId(newSlices[0].id);
    }
  }, [image, numCols, numRows, gridWidth, gridHeight, gridOffsetX, gridOffsetY, gridGapX, gridGapY, frameDelay, playSound]);

  // Apply quick preset grids
  const setPresetGrid = (size) => {
    if (!image) return;
    playSound('click');
    setGridWidth(size);
    setGridHeight(size);
    setGridOffsetX(0);
    setGridOffsetY(0);
    setGridGapX(0);
    setGridGapY(0);
    
    const cols = Math.max(1, Math.floor(image.width / size));
    const rows = Math.max(1, Math.floor(image.height / size));
    setNumCols(cols);
    setNumRows(rows);
    
    const newSlices = [];
    let counter = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        newSlices.push({
          id: `preset_${r}_${c}_${Date.now()}`,
          name: `Frame ${counter}`,
          x: c * size,
          y: r * size,
          w: size,
          h: size,
          delay: frameDelay
        });
        counter++;
      }
    }
    setSlices(newSlices);
    if (newSlices.length > 0) {
      setActiveSliceId(newSlices[0].id);
    }
  };

  // Center/fit viewport
  const resetWorkspace = useCallback(() => {
    if (!image) return;
    playSound('click');
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentNode;
    const parentRect = parent.getBoundingClientRect();
    
    // Scale to fit
    const fitZoom = Math.max(1, Math.min(
      Math.floor((parentRect.width - 40) / image.width),
      Math.floor((parentRect.height - 40) / image.height)
    ));
    
    setZoom(fitZoom || 2);
    setPan({
      x: (parentRect.width - image.width * (fitZoom || 2)) / 2,
      y: (parentRect.height - image.height * (fitZoom || 2)) / 2
    });
  }, [image, playSound]);

  // --- File processing ---
  const processFile = (file) => {
    if (!file || !file.type.match('image.*')) return;
    playSound('click');
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        setImageSrc(event.target.result);
        setResultGif(null);
        
        // Auto setup defaults
        const w = img.width;
        const h = img.height;
        
        // Initial setup for standard grid
        setGridWidth(0);
        setGridHeight(0);
        setGridOffsetX(0);
        setGridOffsetY(0);
        setGridGapX(0);
        setGridGapY(0);
        setNumCols(5);
        setNumRows(1);
        
        // Setup initial 5 frames
        const initialWidth = Math.floor(w / 5);
        const tempSlices = [];
        for (let i = 0; i < 5; i++) {
          tempSlices.push({
            id: `init_${i}_${Date.now()}`,
            name: `Frame ${i + 1}`,
            x: i * initialWidth,
            y: 0,
            w: initialWidth,
            h: h,
            delay: 150
          });
        }
        setSlices(tempSlices);
        setActiveSliceId(tempSlices[0].id);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e) => processFile(e.target.files[0]);
  
  const handleDragOver = (e) => { e.preventDefault(); setIsDraggingFile(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDraggingFile(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  // Trigger fit when image loads
  useEffect(() => {
    if (image) {
      resetWorkspace();
    }
  }, [image, resetWorkspace]);

  // --- Keyboard Pan Hook (Spacebar listener) ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
        isSpacePressed.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        isSpacePressed.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = 'default';
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Workspace Canvas Rendering ---
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    
    const parent = canvas.parentNode;
    const rect = parent.getBoundingClientRect();
    canvas.width = rect.width || 600;
    canvas.height = Math.max(450, rect.height || 450);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Transparent chessboard background inside workspace
    const sz = 8;
    for (let x = 0; x < canvas.width; x += sz * 2) {
      for (let y = 0; y < canvas.height; y += sz * 2) {
        ctx.fillStyle = 'rgba(238, 221, 197, 0.4)';
        ctx.fillRect(x, y, sz, sz);
        ctx.fillRect(x + sz, y + sz, sz, sz);
        ctx.fillStyle = 'rgba(226, 216, 195, 0.4)';
        ctx.fillRect(x + sz, y, sz, sz);
        ctx.fillRect(x, y + sz, sz, sz);
      }
    }
    
    ctx.imageSmoothingEnabled = false;
    
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    
    // Draw Loaded Image
    ctx.drawImage(image, 0, 0);
    
    // Draw Pixel Grid (zoomed in helper)
    if (showGrid && zoom >= 4) {
      ctx.strokeStyle = 'rgba(110, 110, 110, 0.2)';
      ctx.lineWidth = 0.5 / zoom;
      for (let x = 0; x <= image.width; x++) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, image.height);
        ctx.stroke();
      }
      for (let y = 0; y <= image.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(image.width, y);
        ctx.stroke();
      }
    }
    
    // Draw Passive Slices Grid
    if (showSlicesGrid) {
      ctx.lineWidth = 1.5 / zoom;
      slices.forEach((s) => {
        if (s.id === activeSliceId) return;
        
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 1;
        ctx.strokeStyle = 'rgba(125, 145, 105, 0.7)'; // Folk green
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(125, 145, 105, 0.85)';
        ctx.font = `bold ${Math.max(6, 11 / zoom)}px monospace`;
        ctx.fillText(s.name, s.x + 2 / zoom, s.y + 9 / zoom);
      });
    }
    
    // Draw Active Selection Frame & Handles
    const active = slices.find(s => s.id === activeSliceId);
    if (active) {
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 3;
      ctx.lineWidth = 2 / zoom;
      ctx.strokeStyle = '#a53030'; // Red thread
      ctx.setLineDash([4 / zoom, 2 / zoom]);
      ctx.strokeRect(active.x, active.y, active.w, active.h);
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      
      // Handles
      const hs = 6 / zoom;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#a53030';
      ctx.lineWidth = 1.5 / zoom;
      
      const x1 = active.x, x2 = active.x + active.w, xm = active.x + active.w/2;
      const y1 = active.y, y2 = active.y + active.h, ym = active.y + active.h/2;
      
      const drawHandle = (hx, hy) => {
        ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
        ctx.strokeRect(hx - hs/2, hy - hs/2, hs, hs);
      };
      
      drawHandle(x1, y1); // TL
      drawHandle(x2, y1); // TR
      drawHandle(x1, y2); // BL
      drawHandle(x2, y2); // BR
      drawHandle(x1, ym); // L
      drawHandle(x2, ym); // R
      drawHandle(xm, y1); // T
      drawHandle(xm, y2); // B
    }
    
    ctx.restore();
  }, [image, slices, activeSliceId, zoom, pan, showGrid, showSlicesGrid]);

  // Mouse space parsing
  const getMousePos = (evt) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    return {
      x: (mx - pan.x) / zoom,
      y: (my - pan.y) / zoom
    };
  };

  // Collision checks
  const detectHit = (mx, my) => {
    if (slices.length === 0) return null;
    const thresh = 8 / zoom;
    
    // Check active handles first
    const active = slices.find(s => s.id === activeSliceId);
    if (active) {
      const x1 = active.x, x2 = active.x + active.w;
      const y1 = active.y, y2 = active.y + active.h;
      
      if (Math.abs(mx - x1) < thresh && Math.abs(my - y1) < thresh) return { type: 'resizeTL', id: active.id };
      if (Math.abs(mx - x2) < thresh && Math.abs(my - y1) < thresh) return { type: 'resizeTR', id: active.id };
      if (Math.abs(mx - x1) < thresh && Math.abs(my - y2) < thresh) return { type: 'resizeBL', id: active.id };
      if (Math.abs(mx - x2) < thresh && Math.abs(my - y2) < thresh) return { type: 'resizeBR', id: active.id };
      
      if (Math.abs(mx - x1) < thresh && my >= y1 && my <= y2) return { type: 'resizeL', id: active.id };
      if (Math.abs(mx - x2) < thresh && my >= y1 && my <= y2) return { type: 'resizeR', id: active.id };
      if (Math.abs(my - y1) < thresh && mx >= x1 && mx <= x2) return { type: 'resizeT', id: active.id };
      if (Math.abs(my - y2) < thresh && mx >= x1 && mx <= x2) return { type: 'resizeB', id: active.id };
    }
    
    // Check click on active slice
    if (active) {
      if (mx >= active.x && mx <= active.x + active.w && my >= active.y && my <= active.y + active.h) {
        return { type: 'select', id: active.id, slice: active };
      }
    }
    
    // Check click on other slices
    for (let i = slices.length - 1; i >= 0; i--) {
      const s = slices[i];
      if (s.id === activeSliceId) continue;
      if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) {
        return { type: 'select', id: s.id, slice: s };
      }
    }
    
    return null;
  };

  const handleMouseDown = (e) => {
    if (!image) return;
    
    // Pan mode (Spacebar or Middle Click)
    if (e.button === 1 || isSpacePressed.current) {
      dragState.current = {
        isDragging: true,
        action: { type: 'pan' },
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y
      };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    
    const { x, y } = getMousePos(e);
    const hit = detectHit(x, y);
    
    if (hit) {
      if (hit.type === 'select') {
        setActiveSliceId(hit.id);
        dragState.current = {
          isDragging: true,
          action: { type: 'move', id: hit.id, offsetX: x - hit.slice.x, offsetY: y - hit.slice.y }
        };
      } else {
        dragState.current = { isDragging: true, action: hit };
      }
      playSound('click');
    } else {
      // Draw a custom box
      const newId = `draw_${Date.now()}`;
      const px = Math.round(x);
      const py = Math.round(y);
      
      dragState.current = {
        isDragging: true,
        action: { type: 'draw', id: newId, startX: px, startY: py }
      };
      
      const newSlice = {
        id: newId,
        name: `Slice ${slices.length + 1}`,
        x: Math.max(0, Math.min(image.width - 2, px)),
        y: Math.max(0, Math.min(image.height - 2, py)),
        w: 2,
        h: 2,
        delay: frameDelay
      };
      
      setSlices(prev => [...prev, newSlice]);
      setActiveSliceId(newId);
    }
  };

  const handleWindowMouseMove = useCallback((e) => {
    if (!dragState.current.isDragging) return;
    if (!image || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const x = (mx - pan.x) / zoom;
    const y = (my - pan.y) / zoom;
    
    const { action } = dragState.current;
    
    if (action.type === 'pan') {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setPan({
        x: dragState.current.startPanX + dx,
        y: dragState.current.startPanY + dy
      });
      return;
    }
    
    const newSlices = [...slices];
    const idx = newSlices.findIndex(s => s.id === action.id);
    if (idx === -1) return;
    const s = { ...newSlices[idx] };
    
    if (action.type === 'move') {
      s.x = Math.max(0, Math.min(image.width - s.w, Math.round(x - action.offsetX)));
      s.y = Math.max(0, Math.min(image.height - s.h, Math.round(y - action.offsetY)));
    } else if (action.type === 'draw') {
      const startX = action.startX;
      const startY = action.startY;
      s.x = Math.max(0, Math.min(image.width, Math.round(Math.min(startX, x))));
      s.y = Math.max(0, Math.min(image.height, Math.round(Math.min(startY, y))));
      s.w = Math.max(1, Math.min(image.width - s.x, Math.round(Math.abs(x - startX))));
      s.h = Math.max(1, Math.min(image.height - s.y, Math.round(Math.abs(y - startY))));
    } else {
      // Multi-direction resizes
      const x2 = s.x + s.w;
      const y2 = s.y + s.h;
      
      if (action.type.includes('L')) {
        const val = Math.max(0, Math.min(x2 - 1, Math.round(x)));
        s.x = val;
        s.w = x2 - val;
      }
      if (action.type.includes('R')) {
        s.w = Math.max(1, Math.min(image.width - s.x, Math.round(x - s.x)));
      }
      if (action.type.includes('T')) {
        const val = Math.max(0, Math.min(y2 - 1, Math.round(y)));
        s.y = val;
        s.h = y2 - val;
      }
      if (action.type.includes('B')) {
        s.h = Math.max(1, Math.min(image.height - s.y, Math.round(y - s.y)));
      }
    }
    
    newSlices[idx] = s;
    setSlices(newSlices);
  }, [image, pan, zoom, slices]);

  const handleWindowMouseUp = useCallback(() => {
    if (!dragState.current.isDragging) return;
    
    if (dragState.current.action.type === 'draw') {
      const targetId = dragState.current.action.id;
      setSlices(prev => {
        const drawn = prev.find(s => s.id === targetId);
        if (drawn && (drawn.w < 3 || drawn.h < 3)) {
          setActiveSliceId(prev[prev.length - 2]?.id || null);
          return prev.filter(s => s.id !== targetId);
        }
        return prev;
      });
    }
    dragState.current = { isDragging: false, action: null };
    if (canvasRef.current && !isSpacePressed.current) {
      canvasRef.current.style.cursor = 'default';
    }
  }, []);

  // Window events mounting
  useEffect(() => {
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleWindowMouseMove, handleWindowMouseUp]);

  const handleMouseMove = (e) => {
    if (!image) return;
    if (dragState.current.isDragging) return;
    
    const { x, y } = getMousePos(e);
    
    // Hover effects cursor updates
    if (isSpacePressed.current) {
      canvasRef.current.style.cursor = 'grab';
      return;
    }
    const hit = detectHit(x, y);
    if (!hit) {
      canvasRef.current.style.cursor = 'default';
    } else if (['resizeTL', 'resizeBR'].includes(hit.type)) {
      canvasRef.current.style.cursor = 'nwse-resize';
    } else if (['resizeTR', 'resizeBL'].includes(hit.type)) {
      canvasRef.current.style.cursor = 'nesw-resize';
    } else if (['resizeL', 'resizeR'].includes(hit.type)) {
      canvasRef.current.style.cursor = 'ew-resize';
    } else if (['resizeT', 'resizeB'].includes(hit.type)) {
      canvasRef.current.style.cursor = 'ns-resize';
    } else if (hit.type === 'select') {
      canvasRef.current.style.cursor = 'move';
    }
  };

  const handleMouseUp = () => {
    handleWindowMouseUp();
  };

  const handleMouseLeave = () => {
    if (!dragState.current.isDragging && canvasRef.current) {
      canvasRef.current.style.cursor = 'default';
    }
  };

  // Zooming wheel controller
  const handleWheel = (e) => {
    if (!image) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const imX = (mouseX - pan.x) / zoom;
    const imY = (mouseY - pan.y) / zoom;
    
    let nextZoom = zoom;
    if (e.deltaY < 0) {
      nextZoom = Math.min(16, zoom * 1.25);
    } else {
      nextZoom = Math.max(0.5, zoom / 1.25);
    }
    
    setZoom(nextZoom);
    setPan({
      x: mouseX - imX * nextZoom,
      y: mouseY - imY * nextZoom
    });
    playSound('zoom');
  };

  const slicesRef = useRef(slices);
  const frameDelayRef = useRef(frameDelay);
  const playbackModeRef = useRef(playbackMode);
  const previewIndexRef = useRef(previewIndex);

  useEffect(() => {
    slicesRef.current = slices;
  }, [slices]);

  useEffect(() => {
    frameDelayRef.current = frameDelay;
  }, [frameDelay]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  useEffect(() => {
    previewIndexRef.current = previewIndex;
  }, [previewIndex]);

  // --- Real-time Loop Animator ---
  useEffect(() => {
    if (!isPlaying || slices.length === 0) return;
    
    let timerId;
    const tick = () => {
      const currentSlices = slicesRef.current;
      if (currentSlices.length === 0) return;
      
      const prev = previewIndexRef.current;
      let next;
      if (playbackModeRef.current === 'loop') {
        next = (prev + 1) % currentSlices.length;
      } else {
        // Bounce
        let dir = previewDirection.current;
        let test = prev + dir;
        if (test >= currentSlices.length) {
          dir = -1;
          test = Math.max(0, currentSlices.length - 2);
        } else if (test < 0) {
          dir = 1;
          test = Math.min(currentSlices.length - 1, 1);
        }
        previewDirection.current = dir;
        next = test;
      }
      
      previewIndexRef.current = next;
      setPreviewIndex(next);
      
      const nextSlice = currentSlices[next];
      const nextDelay = nextSlice ? nextSlice.delay : frameDelayRef.current;
      
      timerId = setTimeout(tick, nextDelay);
    };
    
    // Start loop
    const currentSlice = slicesRef.current[previewIndexRef.current] || slicesRef.current[0];
    const initialDelay = currentSlice ? currentSlice.delay : frameDelayRef.current;
    timerId = setTimeout(tick, initialDelay);
    
    return () => clearTimeout(timerId);
  }, [isPlaying, slices.length]);

  // Preview renderer canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !image || slices.length === 0) return;
    const ctx = canvas.getContext('2d');
    
    const parent = canvas.parentNode;
    const rect = parent.getBoundingClientRect();
    canvas.width = rect.width || 250;
    canvas.height = 250;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Chessboard transparency background
    const sz = 8;
    for (let x = 0; x < canvas.width; x += sz * 2) {
      for (let y = 0; y < canvas.height; y += sz * 2) {
        ctx.fillStyle = '#eeddc5';
        ctx.fillRect(x, y, sz, sz);
        ctx.fillRect(x + sz, y + sz, sz, sz);
        ctx.fillStyle = '#f4eedb';
        ctx.fillRect(x + sz, y, sz, sz);
        ctx.fillRect(x, y + sz, sz, sz);
      }
    }
    
    const activeFrameIdx = previewIndex >= slices.length ? 0 : previewIndex;
    const slice = slices[activeFrameIdx];
    if (!slice) return;
    
    ctx.imageSmoothingEnabled = false;
    
    // Max scale fit
    const scale = Math.min(
      (canvas.width - 20) / slice.w,
      (canvas.height - 20) / slice.h
    );
    const dx = (canvas.width - slice.w * scale) / 2;
    const dy = (canvas.height - slice.h * scale) / 2;
    
    try {
      ctx.drawImage(
        image,
        Math.floor(slice.x),
        Math.floor(slice.y),
        Math.floor(slice.w),
        Math.floor(slice.h),
        dx,
        dy,
        slice.w * scale,
        slice.h * scale
      );
    } catch(e) {
      // drawing safety
    }
  }, [image, slices, previewIndex]);

  // --- Exporters ---
  
  // 1. GIF Maker
  const makeGif = async () => {
    if (!image || !gifJsLoaded || slices.length === 0) return;
    playSound('chop');
    setIsChopping(true);
    setIsGenerating(true);
    setResultGif(null);
    
    setTimeout(() => setIsChopping(false), 300);
    
    try {
      let workerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';
      try {
        const res = await fetch(workerUrl);
        const txt = await res.text();
        const blob = new Blob([txt], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(blob);
      } catch (err) {}
      
      const pCanvas = processingCanvasRef.current;
      const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
      
      // Determine max canvas size to bound frames
      let maxW = 0;
      let maxH = 0;
      slices.forEach(s => {
        if (s.w > maxW) maxW = s.w;
        if (s.h > maxH) maxH = s.h;
      });
      
      const gw = maxW * exportScale;
      const gh = maxH * exportScale;
      pCanvas.width = gw;
      pCanvas.height = gh;
      
      const gif = new window.GIF({
        workers: 2,
        quality: 5, // Lower quality index = higher graphic fidelity
        width: gw,
        height: gh,
        workerScript: workerUrl,
        background: bgColor === 'transparent' ? null : bgColor,
        transparent: bgColor === 'transparent' ? 0x000000 : null
      });
      
      slices.forEach((s) => {
        pCtx.imageSmoothingEnabled = false;
        
        if (bgColor === 'transparent') {
          pCtx.clearRect(0, 0, gw, gh);
        } else {
          pCtx.fillStyle = bgColor;
          pCtx.fillRect(0, 0, gw, gh);
        }
        
        // Draw centered inside boundary box
        const sw = s.w * exportScale;
        const sh = s.h * exportScale;
        const dx = Math.floor((gw - sw) / 2);
        const dy = Math.floor((gh - sh) / 2);
        
        try {
          pCtx.drawImage(image, s.x, s.y, s.w, s.h, dx, dy, sw, sh);
        } catch(e) {}
        
        gif.addFrame(pCtx, { copy: true, delay: s.delay });
      });
      
      gif.on('finished', (blob) => {
        const url = URL.createObjectURL(blob);
        setResultGif(url);
        setIsGenerating(false);
        playSound('tada');
        triggerConfetti();
      });
      
      gif.render();
      
    } catch(err) {
      console.error(err);
      alert('Error stiching GIF');
      setIsGenerating(false);
    }
  };

  // 2. Export Separate PNG Files as ZIP
  const makeZip = async () => {
    if (!image || slices.length === 0) return;
    playSound('chop');
    setIsGenerating(true);
    
    try {
      const zip = new JSZip();
      const pCanvas = processingCanvasRef.current;
      const pCtx = pCanvas.getContext('2d');
      
      slices.forEach((s, idx) => {
        pCanvas.width = s.w * exportScale;
        pCanvas.height = s.h * exportScale;
        pCtx.imageSmoothingEnabled = false;
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        
        if (bgColor !== 'transparent') {
          pCtx.fillStyle = bgColor;
          pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);
        }
        
        pCtx.drawImage(image, s.x, s.y, s.w, s.h, 0, 0, pCanvas.width, pCanvas.height);
        
        const dataUrl = pCanvas.toDataURL('image/png');
        const b64 = dataUrl.split(',')[1];
        zip.file(`${s.name.replace(/\s+/g, '_') || `slice_${idx + 1}`}.png`, b64, { base64: true });
      });
      
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pixelslicer_frames.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      playSound('tada');
      triggerConfetti();
    } catch (e) {
      console.error(e);
      alert('Error creating ZIP archive.');
    } finally {
      setIsGenerating(false);
    }
  };

  // 3. Export Sprite Sheet Atlas + JSON metadata
  const makeAtlas = async () => {
    if (!image || slices.length === 0) return;
    playSound('chop');
    setIsGenerating(true);
    
    try {
      const zip = new JSZip();
      const pCanvas = processingCanvasRef.current;
      const pCtx = pCanvas.getContext('2d');
      
      // Compute dimensions layout (pack as single row spritesheet)
      let totalW = 0;
      let maxH = 0;
      slices.forEach(s => {
        totalW += s.w * exportScale;
        maxH = Math.max(maxH, s.h * exportScale);
      });
      
      pCanvas.width = totalW;
      pCanvas.height = maxH;
      pCtx.imageSmoothingEnabled = false;
      pCtx.clearRect(0, 0, totalW, maxH);
      
      if (bgColor !== 'transparent') {
        pCtx.fillStyle = bgColor;
        pCtx.fillRect(0, 0, totalW, maxH);
      }
      
      const metaJson = {
        frames: {},
        meta: {
          app: "PixelSlicer Folk Art Slicer",
          version: "1.0.0",
          image: "atlas.png",
          format: "RGBA8888",
          size: { w: totalW, h: maxH },
          scale: exportScale.toString()
        }
      };
      
      let cursorX = 0;
      slices.forEach((s, idx) => {
        const sw = s.w * exportScale;
        const sh = s.h * exportScale;
        
        pCtx.drawImage(image, s.x, s.y, s.w, s.h, cursorX, 0, sw, sh);
        
        const frameName = s.name.replace(/\s+/g, '_') || `frame_${idx + 1}`;
        metaJson.frames[frameName] = {
          frame: { x: cursorX, y: 0, w: sw, h: sh },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: sw, h: sh },
          sourceSize: { w: sw, h: sh }
        };
        
        cursorX += sw;
      });
      
      // Save sheet PNG
      const atlasUrl = pCanvas.toDataURL('image/png');
      const b64 = atlasUrl.split(',')[1];
      zip.file('atlas.png', b64, { base64: true });
      
      // Save JSON
      zip.file('atlas.json', JSON.stringify(metaJson, null, 2));
      
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pixelslicer_atlas.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      playSound('tada');
      triggerConfetti();
    } catch(e) {
      console.error(e);
      alert('Error creating Atlas.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Switch dispatcher for Export action
  const handleExport = () => {
    if (exportFormat === 'gif') {
      makeGif();
    } else if (exportFormat === 'zip') {
      makeZip();
    } else if (exportFormat === 'atlas') {
      makeAtlas();
    }
  };

  // --- Slice Management Utilities ---
  const addNewSlice = () => {
    playSound('click');
    const newId = `slice_${Date.now()}`;
    const newSlice = {
      id: newId,
      name: `Slice ${slices.length + 1}`,
      x: image ? Math.round(image.width * 0.1) : 0,
      y: image ? Math.round(image.height * 0.1) : 0,
      w: image ? Math.round(image.width * 0.2) : 32,
      h: image ? Math.round(image.height * 0.2) : 32,
      delay: frameDelay
    };
    setSlices(prev => [...prev, newSlice]);
    setActiveSliceId(newId);
  };

  const deleteSlice = (id) => {
    playSound('trash');
    setSlices(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeSliceId === id) {
        setActiveSliceId(next[0]?.id || null);
      }
      return next;
    });
  };

  const duplicateSlice = (id) => {
    playSound('click');
    const target = slices.find(s => s.id === id);
    if (!target) return;
    const newId = `dup_${Date.now()}`;
    const newSlice = {
      ...target,
      id: newId,
      name: `${target.name} (Copy)`,
      x: Math.min(image ? image.width - target.w : 100, target.x + 8),
      y: Math.min(image ? image.height - target.h : 100, target.y + 8)
    };
    setSlices(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, newSlice);
      return next;
    });
    setActiveSliceId(newId);
  };

  const reorderSlice = (id, direction) => {
    playSound('click');
    const idx = slices.findIndex(s => s.id === id);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= slices.length) return;
    
    const next = [...slices];
    const temp = next[idx];
    next[idx] = next[targetIdx];
    next[targetIdx] = temp;
    setSlices(next);
  };

  const clearAllSlices = () => {
    if (confirm("Clear all bounding box slices?")) {
      playSound('trash');
      setSlices([]);
      setActiveSliceId(null);
    }
  };

  // --- Volume cycle ---
  const toggleMute = () => {
    let nextVol = 0.5;
    if (volume > 0.4) nextVol = 0; // High -> Mute
    else if (volume === 0) nextVol = 0.2; // Mute -> Low
    else nextVol = 0.8; // Low -> High
    
    setVolume(nextVol);
    // Play sound to test
    setTimeout(() => {
      if (nextVol > 0) {
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          g.gain.setValueAtTime(nextVol * 0.1, ctx.currentTime);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.05);
        } catch(e) {}
      }
    }, 50);
  };

  // --- Tutorial Steps ---
  const aiPrompt = "retro pixel art sprite sheet of a knight walking, 6 frames perfectly spaced in a single horizontal row, isolated solid blue background, crisp details, 16-bit";
  
  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(aiPrompt);
    playSound('copy');
    setIsPromptCopied(true);
    setTimeout(() => setIsPromptCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-fabric flex flex-col items-center py-6 px-4 overflow-x-hidden select-none">
      <canvas ref={processingCanvasRef} className="hidden" />

      {/* --- HEADER --- */}
      <div className="text-center mb-8 flex flex-col items-center swing-element relative">
        <div className="absolute -top-3 right-[-100px] flex items-center gap-2">
          {/* Sound Synthesizer Controller */}
          <button 
            onClick={toggleMute}
            className="w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#4a2c11] bg-[#fdfbf7] hover:scale-105 transition-transform shadow-md"
            title="Audio Synthesizer Settings"
          >
            {volume === 0 ? <VolumeX size={18} className="text-[#a53030]" /> : 
             volume < 0.4 ? <Volume1 size={18} className="text-[#a67c52]" /> : 
             <Volume2 size={18} className="text-[#557a46]" />}
          </button>
        </div>

        <h1 className="text-5xl md:text-6xl title-font mb-2 transition-transform duration-300 hover:scale-105 cursor-default select-none">
          Pixel<span className="title-dark">Slicer</span>
        </h1>
        
        <div className="ribbon-container hover:scale-103 transition-transform duration-300 cursor-default">
          <div className="pin pin-left"></div>
          <div className="pin pin-right"></div>
          <div className="ribbon">
            <div className="ribbon-stitch"></div>
            <span className="flex items-center gap-2 text-sm md:text-base">
              <Scissors size={18} className="icon-embroidered" /> 
              Tactile Folk Art Digital Sprite Cutter
            </span>
          </div>
        </div>
        
        {/* Tutorial Button */}
        <button 
          onClick={() => { playSound('page'); setTutorialStep(0); setIsTutorialOpen(true); }}
          className="mt-4 flex items-center gap-2 btn-small text-xs shadow-md"
        >
          <BookOpen size={14} className="text-[#a53030]" /> 
          <span>How to Settle AI Sprites</span>
        </button>
      </div>

      {/* --- WORKSPACE LAYOUT --- */}
      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* --- LEFT SIDEBAR: CONTROLS & GRID --- */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Patch: Upload Image */}
          <div className="patch-container patch-left">
            <div className="patch-stitch"></div>
            <h2 className="text-lg font-extrabold mb-3 flex items-center gap-2 text-[#4a2c11]">
              <UploadCloud size={20} className="text-[#a53030] icon-embroidered" /> 
              Import Canvas
            </h2>
            
            <div 
              className={`upload-box ${isDraggingFile ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                accept="image/png, image/jpeg, image/webp" 
                className="hidden" 
              />
              <ImageIcon size={38} className="mx-auto mb-2 text-[#a53030] opacity-80" />
              <span className="font-bold text-[#a53030] block mb-1 text-sm md:text-base">Click or Drop a file</span>
              <span className="text-xs font-semibold text-[#8b5a2b]">PNG, JPG, WEBP up to 8MB</span>
            </div>
            
            {image && (
              <div className="mt-3 p-2 bg-[#fdfbf7] rounded border border-[#d4c0a8] flex items-center gap-2 text-xs font-mono text-[#5c4a3d]">
                <Info size={14} className="text-[#7d9169] shrink-0" />
                <span className="truncate">Loaded: {image.width} × {image.height}px</span>
              </div>
            )}
          </div>

          {/* Patch: Grid and Slicing Settings */}
          <div className="patch-container patch-left">
            <div className="patch-stitch"></div>
            <h2 className="text-lg font-extrabold mb-3 flex items-center gap-2 text-[#4a2c11]">
              <Grid size={20} className="text-[#a53030] icon-embroidered" /> 
              Slicing Tools
            </h2>
            
            {/* Presets Grid */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-[#5c4a3d] mb-1.5 uppercase">Quick Presets</label>
              <div className="flex gap-2">
                {[16, 32, 64].map(sz => (
                  <button 
                    key={sz} 
                    onClick={() => setPresetGrid(sz)} 
                    disabled={!image}
                    className="flex-1 py-1.5 btn-small text-xs font-bold"
                  >
                    {sz} × {sz}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Grid form parameters */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1">Columns</label>
                <div className="input-tag-container">
                  <div className="input-tag-hole"></div>
                  <input 
                    type="number" 
                    value={numCols} 
                    disabled={!image}
                    onFocus={() => playSound('click')} 
                    onChange={(e) => setNumCols(Math.max(1, parseInt(e.target.value) || 1))} 
                    className="input-stitched py-1 px-2 text-sm"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1">Rows</label>
                <div className="input-tag-container">
                  <div className="input-tag-hole"></div>
                  <input 
                    type="number" 
                    value={numRows} 
                    disabled={!image}
                    onFocus={() => playSound('click')} 
                    onChange={(e) => setNumRows(Math.max(1, parseInt(e.target.value) || 1))} 
                    className="input-stitched py-1 px-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1">Frame Width</label>
                <div className="input-tag-container">
                  <div className="input-tag-hole"></div>
                  <input 
                    type="number" 
                    value={gridWidth} 
                    disabled={!image}
                    placeholder="Auto"
                    onFocus={() => playSound('click')} 
                    onChange={(e) => setGridWidth(Math.max(0, parseInt(e.target.value) || 0))} 
                    className="input-stitched py-1 px-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1">Frame Height</label>
                <div className="input-tag-container">
                  <div className="input-tag-hole"></div>
                  <input 
                    type="number" 
                    value={gridHeight} 
                    disabled={!image}
                    placeholder="Auto"
                    onFocus={() => playSound('click')} 
                    onChange={(e) => setGridHeight(Math.max(0, parseInt(e.target.value) || 0))} 
                    className="input-stitched py-1 px-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1">Gap X</label>
                <div className="input-tag-container">
                  <div className="input-tag-hole"></div>
                  <input 
                    type="number" 
                    value={gridGapX} 
                    disabled={!image}
                    onFocus={() => playSound('click')} 
                    onChange={(e) => setGridGapX(Math.max(0, parseInt(e.target.value) || 0))} 
                    className="input-stitched py-1 px-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1">Gap Y</label>
                <div className="input-tag-container">
                  <div className="input-tag-hole"></div>
                  <input 
                    type="number" 
                    value={gridGapY} 
                    disabled={!image}
                    onFocus={() => playSound('click')} 
                    onChange={(e) => setGridGapY(Math.max(0, parseInt(e.target.value) || 0))} 
                    className="input-stitched py-1 px-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                onClick={applyGridSlices} 
                disabled={!image}
                className="btn-wood text-sm w-full py-1"
              >
                <span className="btn-wood-inner py-2 font-bold">
                  Slice Grid
                </span>
              </button>

              <button 
                onClick={autoDetectSlices} 
                disabled={!image}
                className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#a53030] hover:bg-[#faefe8] transition-colors rounded-xl py-2 px-3 text-[#a53030] font-extrabold text-sm"
              >
                <Wand2 size={16} />
                Auto-Detect Boundary Sprites
              </button>
            </div>
          </div>
        </div>

        {/* --- CENTER AREA: CANVAS WORKSPACE --- */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Main workspace */}
          <div className="patch-container patch-right flex flex-col min-h-[460px]">
            <div className="patch-stitch"></div>
            
            <div className="relative z-10 flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-[#4a5d3a] flex items-center gap-2">
                <Move size={20} className="icon-embroidered" /> 
                Canvas Workspace
              </h3>
              
              <div className="flex items-center gap-2">
                {/* Reset fit */}
                <button 
                  onClick={resetWorkspace} 
                  disabled={!image} 
                  className="btn-small p-1.5" 
                  title="Fit Screen"
                >
                  <RotateCcw size={14} />
                </button>
                
                {/* Zoom control */}
                <button 
                  onClick={() => { setZoom(z => Math.max(0.5, z / 1.5)); playSound('zoom'); }} 
                  disabled={!image} 
                  className="btn-small p-1.5"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="font-mono text-xs font-extrabold text-[#557a46] px-1 bg-white border border-[#aebc9e] rounded shadow-inner">
                  {Math.round(zoom * 100)}%
                </span>
                <button 
                  onClick={() => { setZoom(z => Math.min(16, z * 1.5)); playSound('zoom'); }} 
                  disabled={!image} 
                  className="btn-small p-1.5"
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            </div>
            
            {/* Viewport Guidelines */}
            <div className="relative z-10 flex flex-wrap gap-4 text-xs font-semibold text-[#557a46] mb-3 bg-[#e2e5cd]/40 p-2 rounded-lg border border-[#aebc9e]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showGrid} 
                  onChange={(e) => { playSound('click'); setShowGrid(e.target.checked); }} 
                  className="wood-checkbox shrink-0" 
                />
                <span>Pixel Grid (Zoom ≥ 400%)</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showSlicesGrid} 
                  onChange={(e) => { playSound('click'); setShowSlicesGrid(e.target.checked); }} 
                  className="wood-checkbox shrink-0" 
                />
                <span>Show Slice Guides</span>
              </label>

              <span className="ml-auto text-[10px] opacity-75 font-normal">
                [Spacebar + Drag] to Pan | Drag empty area to slice box
              </span>
            </div>
            
            {/* Main Interactive Canvas wrapper */}
            <div className="preview-box flex-grow flex items-center justify-center p-2 min-h-[380px] relative overflow-hidden bg-[#faf8f4]">
              <div className="preview-stitch"></div>
              {imageSrc ? (
                <canvas 
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onWheel={handleWheel}
                  className="absolute inset-0 w-full h-full cursor-default select-none touch-none"
                  style={{ touchAction: 'none' }} 
                />
              ) : (
                <div className="z-20 text-[#7d9169] flex flex-col items-center opacity-65">
                   <ImageIcon size={56} className="mb-3" />
                   <span className="font-extrabold text-base font-mono">Drag Sprite Sheet here to Load...</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Bottom Grid: Live Preview & Slice Inspector Side-by-Side */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* Live Playback Animator Box */}
            <div className="md:col-span-5 patch-container patch-right flex flex-col">
              <div className="patch-stitch"></div>
              
              <h3 className="text-lg font-bold text-[#4a5d3a] flex items-center gap-2 mb-3">
                <Play size={20} className="icon-embroidered"/> 
                Live Animator
              </h3>
              
              {/* Playing viewport */}
              <div className="border-4 border-double border-[#aebc9e] rounded-xl flex items-center justify-center relative bg-[#f4eedb] overflow-hidden p-2 min-h-[220px]">
                {slices.length > 0 ? (
                  <canvas 
                    ref={previewCanvasRef} 
                    className="max-w-full h-auto pixelated rounded shadow-inner"
                  />
                ) : (
                  <div className="text-[#8c9e78] font-bold text-xs text-center flex flex-col items-center">
                    <span>✨ Your animation will loop here</span>
                  </div>
                )}
              </div>
              
              {/* Player Controllers */}
              <div className="mt-4 flex flex-col gap-3">
                <div className="flex items-center gap-3 justify-center">
                  <button 
                    onClick={() => { playSound('click'); setIsPlaying(p => !p); }} 
                    disabled={slices.length === 0}
                    className="btn-small flex items-center justify-center p-2 rounded-full w-10 h-10"
                    title={isPlaying ? "Pause Playback" : "Play Playback"}
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  
                  <div className="flex bg-white rounded-lg border border-[#d4c0a8] shadow-inner p-1">
                    <button 
                      onClick={() => { playSound('click'); setPlaybackMode('loop'); }} 
                      className={`px-3 py-1 text-xs font-bold rounded ${playbackMode === 'loop' ? 'bg-[#7d9169] text-white' : 'text-[#5c4a3d]'}`}
                    >
                      Loop
                    </button>
                    <button 
                      onClick={() => { playSound('click'); setPlaybackMode('bounce'); }} 
                      className={`px-3 py-1 text-xs font-bold rounded ${playbackMode === 'bounce' ? 'bg-[#7d9169] text-white' : 'text-[#5c4a3d]'}`}
                    >
                      Yo-Yo
                    </button>
                  </div>
                </div>
                
                {/* Global FPS control */}
                <div>
                  <div className="flex justify-between text-xs font-bold text-[#5c4a3d] mb-1">
                    <span>Playback delay</span>
                    <span>{frameDelay} ms ({Math.round(1000 / frameDelay)} FPS)</span>
                  </div>
                  <input 
                    type="range" 
                    min="30" 
                    max="1000" 
                    step="10"
                    value={frameDelay} 
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setFrameDelay(val);
                      // Update delays of frames that match the old default
                      setSlices(prev => prev.map(s => s.delay === frameDelay ? { ...s, delay: val } : s));
                    }}
                    className="w-full accent-[#7d9169] cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Slices list editor inspector */}
            <div className="md:col-span-7 patch-container patch-right flex flex-col h-[390px]">
              <div className="patch-stitch"></div>
              
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-bold text-[#4a5d3a] flex items-center gap-2">
                  <Sliders size={20} className="icon-embroidered" /> 
                  Slice Inspector
                </h3>
                <div className="flex gap-2">
                  <button 
                    onClick={addNewSlice} 
                    className="btn-small text-xs py-1 px-2 flex items-center gap-1 font-bold"
                  >
                    <Plus size={12} /> Add
                  </button>
                  <button 
                    onClick={clearAllSlices} 
                    className="btn-small text-xs py-1 px-2 border-red-800 text-red-800 flex items-center gap-1 font-bold"
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                </div>
              </div>
              
              {/* Slice items container scrollable */}
              <div className="flex-grow overflow-y-auto pr-1 flex flex-col gap-2 relative">
                {slices.length > 0 ? (
                  slices.map((slice, idx) => {
                    const isActive = slice.id === activeSliceId;
                    return (
                      <div 
                        key={slice.id} 
                        onClick={() => setActiveSliceId(slice.id)}
                        className={`flex items-center gap-2 p-2 rounded-xl border transition-all cursor-pointer bg-[#fdfbf7]
                          ${isActive ? 'border-[#a53030] shadow-md ring-1 ring-[#a53030]/30' : 'border-[#d4c0a8] hover:border-[#a67c52]'}
                        `}
                      >
                        {/* Miniature sprite box */}
                        <SliceThumbnail image={image} slice={slice} />
                        
                        <div className="flex-grow min-w-0">
                          <input 
                            type="text" 
                            value={slice.name} 
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSlices(prev => prev.map(s => s.id === slice.id ? { ...s, name: val } : s));
                            }}
                            className="w-full text-xs font-bold text-[#4a2c11] bg-transparent border-b border-dashed border-[#d4c0a8] outline-none"
                          />
                          
                          {/* Dimensions coordinate grids inline editing */}
                          <div className="grid grid-cols-5 gap-1 mt-1.5 text-[9px] font-mono text-[#8b5a2b]">
                            <div>
                              <span>X:</span>
                              <input 
                                type="number" 
                                value={slice.x} 
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  setSlices(prev => prev.map(s => s.id === slice.id ? { ...s, x: val } : s));
                                }}
                                className="w-full bg-[#f4eedb] border border-[#d4c0a8] px-0.5 rounded text-[10px]"
                              />
                            </div>
                            
                            <div>
                              <span>Y:</span>
                              <input 
                                type="number" 
                                value={slice.y} 
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  setSlices(prev => prev.map(s => s.id === slice.id ? { ...s, y: val } : s));
                                }}
                                className="w-full bg-[#f4eedb] border border-[#d4c0a8] px-0.5 rounded text-[10px]"
                              />
                            </div>

                            <div>
                              <span>W:</span>
                              <input 
                                type="number" 
                                value={slice.w} 
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value) || 1);
                                  setSlices(prev => prev.map(s => s.id === slice.id ? { ...s, w: val } : s));
                                }}
                                className="w-full bg-[#f4eedb] border border-[#d4c0a8] px-0.5 rounded text-[10px]"
                              />
                            </div>

                            <div>
                              <span>H:</span>
                              <input 
                                type="number" 
                                value={slice.h} 
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value) || 1);
                                  setSlices(prev => prev.map(s => s.id === slice.id ? { ...s, h: val } : s));
                                }}
                                className="w-full bg-[#f4eedb] border border-[#d4c0a8] px-0.5 rounded text-[10px]"
                              />
                            </div>

                            <div>
                              <span>Ms:</span>
                              <input 
                                type="number" 
                                value={slice.delay} 
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const val = Math.max(10, parseInt(e.target.value) || 10);
                                  setSlices(prev => prev.map(s => s.id === slice.id ? { ...s, delay: val } : s));
                                }}
                                className="w-full bg-[#f4eedb] border border-[#d4c0a8] px-0.5 rounded text-[10px]"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Actions buttons */}
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => duplicateSlice(slice.id)} className="p-1 hover:text-[#557a46] hover:bg-gray-100 rounded text-gray-400" title="Duplicate frame">
                            <CopyPlus size={13} />
                          </button>
                          <button onClick={() => deleteSlice(slice.id)} className="p-1 hover:text-[#a53030] hover:bg-gray-100 rounded text-gray-400" title="Delete Frame">
                            <Trash2 size={13} />
                          </button>
                        </div>
                        
                        {/* List Reorder handlers */}
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <button 
                            onClick={() => reorderSlice(slice.id, -1)} 
                            disabled={idx === 0}
                            className="p-0.5 hover:bg-gray-100 disabled:opacity-30 rounded text-gray-500"
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button 
                            onClick={() => reorderSlice(slice.id, 1)} 
                            disabled={idx === slices.length - 1}
                            className="p-0.5 hover:bg-gray-100 disabled:opacity-30 rounded text-gray-500"
                          >
                            <ArrowDown size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-[#8c9e78] font-bold p-4">
                    <Info size={32} className="mb-2 opacity-50" />
                    <span className="text-xs">No active bounding slices found. Setup a Grid Slicer above or drag boxes directly on canvas.</span>
                  </div>
                )}
              </div>
            </div>
            
          </div>

          {/* Export Settings Panel */}
          <div className="patch-container patch-accent mt-2">
            <div className="patch-stitch"></div>
            
            <h3 className="text-xl font-bold mb-4 text-[#a53030] flex items-center gap-2">
               <Download size={24} className="icon-embroidered"/> Exporter Panel
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5 items-end">
              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1 uppercase">Export Format</label>
                <select 
                  value={exportFormat} 
                  onChange={(e) => { playSound('click'); setExportFormat(e.target.value); }}
                  className="w-full bg-[#fdfbf7] p-2 text-sm font-bold border border-[#d4c0a8] rounded-xl outline-none text-[#4a2c11] cursor-pointer"
                >
                  <option value="gif">Animated GIF (.gif)</option>
                  <option value="zip">Separate PNG frames (.zip)</option>
                  <option value="atlas">Packed Sprite Atlas (.zip)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1 uppercase">Pixel Multiplier (Scale)</label>
                <select 
                  value={exportScale} 
                  onChange={(e) => { playSound('click'); setExportScale(parseInt(e.target.value)); }}
                  className="w-full bg-[#fdfbf7] p-2 text-sm font-bold border border-[#d4c0a8] rounded-xl outline-none text-[#4a2c11] cursor-pointer"
                >
                  <option value="1">1x scale (Raw assets)</option>
                  <option value="2">2x scale (Medium scale)</option>
                  <option value="4">4x scale (Standard scale)</option>
                  <option value="8">8x scale (High fidelity)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5c4a3d] mb-1 uppercase">Bg Color (Transparency checker)</label>
                <div className="flex gap-2 items-center bg-[#fdfbf7] p-1.5 rounded-xl border border-[#d4c0a8] h-[38px]">
                  <input 
                    type="color" 
                    value={bgColor === 'transparent' ? '#000000' : bgColor}
                    disabled={bgColor === 'transparent'}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-8 h-6 rounded cursor-pointer border border-[#cbd5e1] disabled:opacity-40" 
                  />
                  
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-[#4a2c11]">
                    <input 
                      type="checkbox" 
                      checked={bgColor === 'transparent'}
                      onChange={(e) => {
                        playSound('click');
                        setBgColor(e.target.checked ? 'transparent' : '#000000');
                      }}
                      className="wood-checkbox shrink-0" 
                    />
                    <span>Transparent</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center border-t-2 border-dashed border-[#b35656]/30 pt-4">
              <div className="flex justify-center items-center gap-2 group relative">
                <button 
                  onClick={handleExport} 
                  disabled={!image || isGenerating || (exportFormat === 'gif' && !gifJsLoaded) || slices.length === 0} 
                  className="btn-wood text-lg w-full"
                >
                  <span className="btn-wood-inner py-3 font-bold text-base">
                    {isGenerating ? 'Stitching...' : 'Slice a Pixel!'}
                  </span>
                </button>
                
                {/* Wooden Axe Chop Animation indicator */}
                <span 
                  className={`text-4xl absolute -right-6 -top-6 transition-transform origin-bottom-right z-20 pointer-events-none drop-shadow-md
                    ${isChopping ? 'axe-chop' : 'group-hover:-rotate-45 group-hover:scale-105'}
                  `} 
                >
                  🪓
                </span>
              </div>
              
              {/* Finished GIF / download asset box */}
              <div className="bg-[#fdfbf7]/60 border-2 border-dashed border-[#b35656]/50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden">
                {resultGif ? (
                  <div className="flex flex-col items-center gap-3 z-10 w-full">
                    <img 
                      src={resultGif} 
                      alt="Exported GIF" 
                      className="max-h-[100px] pixelated rounded border border-gray-200 shadow-sm" 
                    />
                    <a 
                      href={resultGif} 
                      download="pixelslicer_animation.gif"
                      className="btn-small text-xs py-1.5 px-3 flex items-center gap-1 font-bold"
                      onClick={() => playSound('click')}
                    >
                      <Download size={14} /> Download Animated GIF
                    </a>
                  </div>
                ) : (
                  <span className="text-[#a53030]/70 font-extrabold text-xs text-center">
                    {isGenerating ? "Processing export, please hold... ✨" : "Exported frames/files will display here."}
                  </span>
                )}
              </div>
            </div>

          </div>

        </div>
      </div>

      {/* --- TUTORIAL MODAL --- */}
      {isTutorialOpen && (
        <div className="tutorial-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="tutorial-content patch-container patch-left shadow-2xl relative">
            <div className="patch-stitch"></div>
            
            {/* Close Button */}
            <button 
              onClick={() => { playSound('click'); setIsTutorialOpen(false); }}
              className="absolute top-4 right-4 text-[#a53030] hover:scale-110 transition-transform z-20 bg-[#f0e3cc] rounded-full p-1.5 border-2 border-[#a53030] cursor-pointer"
            >
              <X size={18} />
            </button>

            <h2 className="text-3xl title-font text-center mb-5 mt-1 flex items-center justify-center gap-3">
              <HelpCircle size={28} className="text-[#a53030]" /> Pixel Guide
            </h2>

            <div className="min-h-[220px] flex flex-col justify-center px-2">
              {tutorialStep === 0 && (
                <div className="space-y-3 animate-[fadeIn_0.25s_ease-out]">
                  <h3 className="text-lg font-bold text-[#4a2c11] flex items-center gap-2">
                    <span className="bg-[#a53030] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">1</span> 
                    Generate Sprite Sheets with AI
                  </h3>
                  <p className="text-sm font-semibold text-[#5c4a3d] leading-relaxed">
                    Create pixel art characters using Midjourney, Stable Diffusion, or Gemini. The trick is asking for a <strong className="text-[#a53030]">single horizontal row</strong> of poses on a solid background:
                  </p>
                  <div className="prompt-box group">
                    <p className="text-xs opacity-90 pr-8 leading-relaxed font-mono">{aiPrompt}</p>
                    <button 
                      onClick={handleCopyPrompt}
                      className="absolute top-2.5 right-2.5 text-[#e2d8c3] hover:text-white hover:scale-105 transition-all p-1.5 rounded bg-white/10 cursor-pointer"
                      title="Copy Prompt"
                    >
                      {isPromptCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              )}

              {tutorialStep === 1 && (
                <div className="space-y-3 animate-[fadeIn_0.25s_ease-out]">
                  <h3 className="text-lg font-bold text-[#4a2c11] flex items-center gap-2">
                    <span className="bg-[#a53030] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">2</span> 
                    Use Magic Slicing or Grid
                  </h3>
                  <p className="text-sm font-semibold text-[#5c4a3d] leading-relaxed font-medium">
                    Upload your character sheet. You can slice it automatically with the <strong className="text-[#a53030]">Magic Wand Boundary Auto-Detector</strong> (scans opaque sprite borders).
                  </p>
                  <p className="text-sm font-semibold text-[#5c4a3d] leading-relaxed">
                    Or setup a regular uniform grid using columns and rows (e.g. 16x16, 32x32 presets) for traditional tile maps and animation sheets.
                  </p>
                </div>
              )}

              {tutorialStep === 2 && (
                <div className="space-y-3 animate-[fadeIn_0.25s_ease-out]">
                  <h3 className="text-lg font-bold text-[#4a2c11] flex items-center gap-2">
                    <span className="bg-[#a53030] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">3</span> 
                    Refine, Play & Slice
                  </h3>
                  <p className="text-sm font-semibold text-[#5c4a3d] leading-relaxed">
                    Drag empty parts of the canvas to create custom slices. Select any slice to resize it from handles or coordinate fields in the sidebar list.
                  </p>
                  <p className="text-sm font-semibold text-[#5c4a3d] leading-relaxed">
                    Adjust individual delays or click the wooden <strong className="text-[#a53030]">Slice a Pixel!</strong> button to compile your animation or sprite atlas bundle.
                  </p>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            <div className="mt-6 flex items-center justify-between border-t-2 border-dashed border-[#a67c52]/30 pt-4">
              <button 
                onClick={() => { playSound('page'); setTutorialStep(prev => Math.max(prev - 1, 0)); }}
                disabled={tutorialStep === 0}
                className="btn-small py-1 px-3 text-xs disabled:opacity-40"
              >
                Previous
              </button>
              
              <div className="flex gap-1.5">
                {[0,1,2].map(step => (
                  <div 
                    key={step} 
                    className={`w-2.5 h-2.5 rounded-full border border-[#a67c52] transition-colors 
                      ${tutorialStep === step ? 'bg-[#a53030] border-[#a53030]' : 'bg-transparent'}
                    `} 
                  />
                ))}
              </div>

              {tutorialStep < 2 ? (
                <button 
                  onClick={() => { playSound('page'); setTutorialStep(prev => Math.min(prev + 1, 2)); }} 
                  className="btn-small py-1 px-3 text-xs"
                >
                  Next Step
                </button>
              ) : (
                <button 
                  onClick={() => { playSound('click'); setIsTutorialOpen(false); }} 
                  className="btn-small py-1 px-3 text-xs bg-gradient-to-b from-[#aebc9e] to-[#7d9169] border-[#557a46] text-white shadow-md hover:scale-103"
                >
                  Got it!
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

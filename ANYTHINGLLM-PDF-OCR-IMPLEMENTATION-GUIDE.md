# AnythingLLM OCR Implementation Guide

**Purpose:** Add OCR capability to AnythingLLM's collector service to process scanned PDFs without text layers.

**Date:** November 8, 2025  
**Target Repository:** https://github.com/Mintplex-Labs/anything-llm

---

## Executive Summary

### Problem
- **Current state:** AnythingLLM can only extract text from PDFs that have a text layer
- **Gap:** Scanned documents (images in PDF format) cannot be processed
- **User need:** Local OCR processing for privacy-sensitive documents

### Solution Overview
- **Approach:** Enhance the collector service with OCR detection and processing
- **Location:** `collector/` directory - the document processing service
- **Integration point:** PDF processing pipeline (currently uses `pdf-parse`)
- **Architecture fit:** Clean separation - collector already handles document preprocessing

---

## Technical Context

### Current Architecture

```
AnythingLLM Monorepo Structure:
├── frontend/          # ViteJS + React
├── server/            # Node.js Express (main API, vectorDB)
├── collector/         # Node.js Express (document processor) ← OUR TARGET
├── docker/
└── ...
```

**Collector Service Role:**
- Receives uploaded documents from frontend
- Processes and parses various document types (PDF, DOCX, TXT, etc.)
- Returns extracted text to server for vectorization
- Currently uses `pdf-parse` library for PDFs

**Key Finding:** Issue #3739 notes `pdf-parse` is 7+ years old and has limitations

### Technology Stack
- **Runtime:** Node.js
- **Framework:** Express
- **Current PDF library:** `pdf-parse` v1.1.1
- **Database (server):** Prisma + SQLite
- **Package manager:** Yarn

---

## Implementation Plan

### Phase 1: Code Discovery (START HERE)

**Objectives:**
1. Locate PDF processing code in collector
2. Understand file processing flow
3. Identify injection points for OCR

**Files to examine:**
```bash
collector/
├── index.js                    # Main entry point
├── package.json                # Dependencies
├── utils/
│   ├── files/                  # File handling logic?
│   └── ...                     # Look for PDF processors
└── processSingleFile.js        # Likely entry point (verify)
```

**Search commands:**
```bash
# Find PDF processing code
find collector/ -name "*.js" | xargs grep -l "pdf-parse"
find collector/ -name "*.js" | xargs grep -l "processPDF"
find collector/ -name "*.js" | xargs grep -l "\.pdf"

# Understand file routing
grep -r "processSingleFile" collector/
grep -r "router\." collector/index.js
```

**Questions to answer:**
- [ ] Where does the collector receive uploaded files?
- [ ] How are different file types routed?
- [ ] What function specifically handles PDF processing?
- [ ] What format does the collector return to the server?
- [ ] Are there existing image processing capabilities?

---

### Phase 2: OCR Library Selection

**Recommended Option: `node-tesseract-ocr`**

**Pros:**
- Native Tesseract wrapper (best accuracy)
- Supports 100+ languages
- Good performance
- Active maintenance

**Cons:**
- Requires Tesseract binary installation
- Needs to be bundled in Electron app

**Alternative: `tesseract.js`**
- Pure JavaScript (easier Electron packaging)
- No native dependencies
- Slower but acceptable for local use
- Good for initial POC

**Installation:**
```bash
# For development/testing
cd collector
yarn add node-tesseract-ocr
# OR for pure JS approach
yarn add tesseract.js

# System dependency (users need this)
# Linux: sudo apt-get install tesseract-ocr
# Mac: brew install tesseract
# Windows: Download from GitHub releases
```

---

### Phase 3: Proof of Concept

**Create standalone test script first:**

```javascript
// test-ocr-poc.js (create in collector/ directory)

const fs = require('fs');
const pdf = require('pdf-parse');
const tesseract = require('node-tesseract-ocr');
const sharp = require('sharp'); // For image preprocessing

/**
 * Detect if PDF is scanned (has minimal text)
 * @param {Buffer} dataBuffer - PDF file buffer
 * @returns {Promise<boolean>}
 */
async function isScannedPDF(dataBuffer) {
  const pdfData = await pdf(dataBuffer);
  const textLength = pdfData.text.trim().length;
  const avgCharsPerPage = textLength / pdfData.numpages;
  
  // Threshold: < 100 chars per page suggests scanned
  return avgCharsPerPage < 100;
}

/**
 * Convert PDF to images for OCR
 * Options:
 * 1. pdf-poppler-simple (needs poppler installed)
 * 2. pdf2pic (uses GraphicsMagick/ImageMagick)
 * 3. pdf-lib + canvas (pure JS but complex)
 * 
 * Start with pdf2pic for POC
 */
async function pdfToImages(pdfPath) {
  // TODO: Implement based on chosen library
  // Return array of image buffers or file paths
}

/**
 * Preprocess image for better OCR accuracy
 */
async function preprocessImage(imageBuffer) {
  return await sharp(imageBuffer)
    .greyscale()           // Convert to grayscale
    .normalize()           // Enhance contrast
    .sharpen()            // Sharpen text
    .toBuffer();
}

/**
 * Perform OCR on image
 */
async function ocrImage(imageBuffer, options = {}) {
  const config = {
    lang: options.language || 'eng',
    oem: 1,  // LSTM neural net mode
    psm: 3,  // Automatic page segmentation
  };
  
  const processed = await preprocessImage(imageBuffer);
  return await tesseract.recognize(processed, config);
}

/**
 * Main function to process PDF with OCR fallback
 */
async function processPDFWithOCR(filePath, options = {}) {
  console.log(`Processing: ${filePath}`);
  const startTime = Date.now();
  
  // Step 1: Try standard text extraction
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdf(dataBuffer);
  
  // Step 2: Check if OCR is needed
  const needsOCR = await isScannedPDF(dataBuffer);
  
  if (!needsOCR) {
    console.log('✓ Text layer detected, using standard extraction');
    return {
      text: pdfData.text,
      metadata: {
        pages: pdfData.numpages,
        method: 'text-extraction',
        processingTime: Date.now() - startTime
      }
    };
  }
  
  // Step 3: Apply OCR
  console.log('⚠ Scanned PDF detected, applying OCR...');
  
  const images = await pdfToImages(filePath);
  console.log(`Converting ${images.length} pages to text...`);
  
  const ocrResults = [];
  for (let i = 0; i < images.length; i++) {
    console.log(`Processing page ${i + 1}/${images.length}...`);
    const text = await ocrImage(images[i], options);
    ocrResults.push(text);
  }
  
  return {
    text: ocrResults.join('\n\n--- Page Break ---\n\n'),
    metadata: {
      pages: images.length,
      method: 'ocr',
      processingTime: Date.now() - startTime
    }
  };
}

// Test execution
if (require.main === module) {
  const testFile = process.argv[2];
  
  if (!testFile) {
    console.error('Usage: node test-ocr-poc.js <path-to-pdf>');
    process.exit(1);
  }
  
  processPDFWithOCR(testFile)
    .then(result => {
      console.log('\n=== Results ===');
      console.log(`Method: ${result.metadata.method}`);
      console.log(`Pages: ${result.metadata.pages}`);
      console.log(`Time: ${result.metadata.processingTime}ms`);
      console.log(`Text length: ${result.text.length} characters`);
      console.log('\nFirst 500 characters:');
      console.log(result.text.substring(0, 500));
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { processPDFWithOCR, isScannedPDF, ocrImage };
```

**Testing the POC:**
```bash
# Create a scanned PDF test file
# Option 1: Print a webpage to PDF without text layer
# Option 2: Use online tool to convert image to PDF

node test-ocr-poc.js path/to/scanned.pdf
```

---

### Phase 4: Integration into Collector

**After POC works, integrate into existing code:**

1. **Add dependencies** to `collector/package.json`:
```json
{
  "dependencies": {
    "node-tesseract-ocr": "^2.2.0",
    "pdf2pic": "^3.0.0",
    "sharp": "^0.33.5"
  }
}
```

2. **Create OCR module** at `collector/utils/ocr/`:
```
collector/utils/ocr/
├── index.js           # Main OCR orchestrator
├── detector.js        # Scanned PDF detection
├── processor.js       # OCR processing logic
└── config.js          # OCR configuration
```

3. **Modify PDF processor** to use OCR:
```javascript
// In existing PDF processing file
const { processPDFWithOCR } = require('./utils/ocr');

async function processPDF(filePath) {
  // Check if OCR is enabled
  if (process.env.OCR_ENABLED === 'true') {
    return await processPDFWithOCR(filePath, {
      language: process.env.OCR_LANGUAGE || 'eng',
      threshold: parseInt(process.env.OCR_THRESHOLD || '100')
    });
  }
  
  // Fallback to original behavior
  return await originalPDFProcess(filePath);
}
```

4. **Add configuration** to `collector/.env.example`:
```bash
# OCR Configuration
OCR_ENABLED=true
OCR_LANGUAGE=eng
OCR_THRESHOLD=100
OCR_QUALITY=standard  # standard | high
```

---

### Phase 5: Desktop App Considerations

**Electron Packaging Requirements:**

1. **Bundle Tesseract binaries:**
```javascript
// In electron builder config
{
  "extraResources": [
    {
      "from": "node_modules/tesseract-binary/",
      "to": "tesseract/"
    }
  ]
}
```

2. **Binary path configuration:**
```javascript
// collector/utils/ocr/config.js
const path = require('path');

function getTesseractPath() {
  if (process.env.NODE_ENV === 'production') {
    // Electron packaged app
    return path.join(process.resourcesPath, 'tesseract', 'tesseract');
  }
  // Development - use system tesseract
  return 'tesseract';
}

module.exports = { getTesseractPath };
```

3. **Alternative: Use tesseract.js** (no binaries needed)
   - Easier packaging
   - Slower but acceptable
   - Pure JavaScript
   - Better cross-platform compatibility

---

### Phase 6: Testing Strategy

**Test Cases:**

1. **Text PDF (control):**
   - ✅ Should extract normally
   - ✅ Should not trigger OCR
   - ✅ Performance: <1 second

2. **Scanned PDF (simple):**
   - ✅ Should detect as scanned
   - ✅ Should trigger OCR
   - ✅ Should extract readable text
   - ✅ Performance: <30 seconds for 10 pages

3. **Mixed PDF:**
   - ✅ Should handle pages with text layer
   - ✅ Should OCR scanned pages
   - ✅ Should combine results

4. **Edge cases:**
   - ✅ Poor quality scan
   - ✅ Multi-column layout
   - ✅ Non-English text
   - ✅ Large file (100+ pages)
   - ✅ Image-heavy PDF

**Create test suite:**
```bash
collector/test/
├── fixtures/
│   ├── text-pdf.pdf
│   ├── scanned-pdf.pdf
│   ├── mixed-pdf.pdf
│   └── poor-quality.pdf
└── ocr.test.js
```

---

### Phase 7: Performance Optimization

**Strategies:**

1. **Page batching:** Process multiple pages in parallel
```javascript
const results = await Promise.all(
  images.map((img, i) => ocrImage(img).catch(err => {
    console.error(`Page ${i} failed:`, err);
    return '[OCR Failed]';
  }))
);
```

2. **Progress callbacks:** Report processing status
```javascript
async function processPDFWithOCR(filePath, options = {}) {
  const onProgress = options.onProgress || (() => {});
  
  for (let i = 0; i < images.length; i++) {
    onProgress({
      current: i + 1,
      total: images.length,
      percentage: ((i + 1) / images.length) * 100
    });
    
    const text = await ocrImage(images[i]);
    ocrResults.push(text);
  }
}
```

3. **Caching:** Store OCR results to avoid reprocessing
```javascript
const crypto = require('crypto');

function getFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function processPDFWithOCR(filePath) {
  const buffer = fs.readFileSync(filePath);
  const hash = getFileHash(buffer);
  
  // Check cache
  const cached = await getCachedOCR(hash);
  if (cached) return cached;
  
  // Process and cache
  const result = await performOCR(buffer);
  await cacheOCR(hash, result);
  return result;
}
```

---

## Environment Setup

### Development Environment

```bash
# Clone repository
git clone https://github.com/Mintplex-Labs/anything-llm.git
cd anything-llm

# Initial setup
yarn setup

# Install system dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install tesseract-ocr
sudo apt-get install libtesseract-dev

# Install system dependencies (macOS)
brew install tesseract

# Install system dependencies (Windows)
# Download from: https://github.com/UB-Mannheim/tesseract/wiki

# Start collector in dev mode
cd collector
yarn dev
```

### Testing Setup

```bash
# Create test directory
mkdir -p collector/test/fixtures

# Generate test PDFs
# 1. Text PDF - any normal PDF
# 2. Scanned PDF - print webpage to PDF or use online converter
# 3. Mixed PDF - combine both types

# Run POC test
node test-ocr-poc.js collector/test/fixtures/scanned-pdf.pdf
```

---

## Configuration Reference

### Environment Variables

```bash
# collector/.env

# OCR Feature Toggle
OCR_ENABLED=true

# Language code (ISO 639-2)
# Examples: eng, deu, fra, spa, jpn, chi_sim
OCR_LANGUAGE=eng

# Character threshold for scanned PDF detection
# If avg chars/page < threshold, trigger OCR
OCR_THRESHOLD=100

# Processing quality
# standard: faster, good for clean scans
# high: slower, better for poor quality
OCR_QUALITY=standard

# Tesseract binary path (auto-detected if not set)
TESSERACT_PATH=

# Enable preprocessing (grayscale, sharpen, etc.)
OCR_PREPROCESS=true

# Max concurrent page processing
OCR_MAX_WORKERS=4

# Cache OCR results (recommended for large docs)
OCR_CACHE_ENABLED=true
OCR_CACHE_DIR=./cache/ocr
```

---

## Success Criteria

### Minimum Viable Implementation
- [ ] Detects scanned PDFs automatically
- [ ] Extracts text from scanned documents
- [ ] Returns text in same format as current implementation
- [ ] No regression on text-based PDFs
- [ ] Basic error handling

### Enhanced Implementation
- [ ] Progress reporting to frontend
- [ ] Configurable OCR settings
- [ ] Multi-language support
- [ ] Performance optimization (parallel processing)
- [ ] Result caching
- [ ] User-facing quality settings

### Production Ready
- [ ] Comprehensive error handling
- [ ] Logging and monitoring
- [ ] Unit tests (>80% coverage)
- [ ] Integration tests
- [ ] Performance tests
- [ ] Documentation
- [ ] Electron app packaging
- [ ] Cross-platform testing (Windows, macOS, Linux)

---

## Known Issues & Considerations

### From Issue Tracker

1. **Issue #3739:** `pdf-parse` is outdated (7+ years)
   - Consider migrating to newer library
   - Our OCR implementation might be opportunity to modernize

2. **Issue #171:** Large PDF timeout issues
   - OCR will be slower - need good progress indicators
   - Consider page limits or async processing

3. **Issue #2498:** Upload hanging issues
   - Ensure OCR doesn't block other operations
   - Use proper async/await patterns

### Technical Challenges

1. **Binary dependencies:**
   - Tesseract needs to be installed on system
   - Electron packaging complexity
   - Consider fallback to tesseract.js for pure JS solution

2. **Performance:**
   - OCR is CPU-intensive
   - Large documents will be slow
   - Need progress indicators and async processing

3. **Accuracy:**
   - Poor quality scans may produce garbled text
   - Multi-column layouts can be tricky
   - Non-English text requires language packs

4. **Memory usage:**
   - Converting PDFs to images uses significant memory
   - Process pages in batches
   - Clean up temporary files

---

## Next Steps for Claude Code

### Immediate Actions (Start Here)

1. **Explore the codebase:**
   ```bash
   cd collector
   
   # Find PDF processing
   find . -name "*.js" | xargs grep -l "pdf"
   
   # Understand structure
   tree -L 3 -I node_modules
   
   # Check current dependencies
   cat package.json | jq .dependencies
   ```

2. **Run the existing collector:**
   ```bash
   yarn dev
   # Upload a test PDF to see current behavior
   ```

3. **Create POC test:**
   - Save the `test-ocr-poc.js` script
   - Install minimal dependencies
   - Test with a scanned PDF
   - Measure performance

4. **Map integration points:**
   - Document the exact file/function where PDF processing happens
   - Identify where to inject OCR logic
   - Understand the return format expected

### Questions to Investigate

- [ ] What HTTP endpoints does collector expose?
- [ ] How does collector communicate with server?
- [ ] Are there websockets for progress updates?
- [ ] How are errors currently handled and reported?
- [ ] What's the maximum file size allowed?
- [ ] Is there already any image processing capability?

---

## Resources

### Documentation
- AnythingLLM Docs: https://docs.anythingllm.com/
- Tesseract.js: https://tesseract.projectnaptha.com/
- Node-tesseract-ocr: https://github.com/zadam/node-tesseract-ocr
- pdf-parse: https://www.npmjs.com/package/pdf-parse
- sharp: https://sharp.pixelplumbing.com/

### Related Issues
- #3739: Collector PDF font bug
- #171: Large PDF timeout
- #2498: PDF upload hanging

### Community
- GitHub Discussions: https://github.com/Mintplex-Labs/anything-llm/discussions
- Discord: (check README for invite)

---

## Notes for Implementation

### Code Style
- Follow existing collector patterns
- Use async/await consistently
- Add comprehensive error handling
- Include logging for debugging
- Write unit tests for new functions

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/ocr-support

# Make changes incrementally
git add collector/utils/ocr/
git commit -m "feat(collector): add OCR detection logic"

# Test thoroughly before PR
# Follow contributing guidelines in CONTRIBUTING.md
```

### Communication
- Open an issue first to discuss approach
- Reference the issue in commits
- Update documentation
- Add configuration examples
- Consider feature flag for gradual rollout

---

**Good luck with the implementation! This is a valuable feature that will benefit many users needing privacy-preserving document processing.**

---

*Guide created: November 8, 2025*  
*For: AnythingLLM OCR Enhancement*  
*Status: Ready for implementation*

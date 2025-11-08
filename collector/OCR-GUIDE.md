# OCR Guide for AnythingLLM Collector

## Overview

The AnythingLLM collector service includes built-in OCR (Optical Character Recognition) capabilities for processing scanned documents and images. This allows you to extract text from PDFs and images that don't have a text layer.

## Features

### ✅ What's Supported

1. **Fully Scanned PDFs**: Documents where all pages are images without text layers
2. **Mixed PDFs**: Documents with both text-layer pages and scanned pages (NEW!)
3. **Image Files**: PNG, JPG, JPEG, and other image formats
4. **Multi-language Support**: 100+ languages via Tesseract
5. **Automatic Detection**: Smart detection of pages needing OCR
6. **Parallel Processing**: Multiple CPU cores for faster processing

### 🎯 How It Works

#### For PDFs:
1. **Text Extraction First**: Attempts standard PDF text extraction
2. **Page Analysis**: Checks each page for sufficient text content
3. **Selective OCR**: Pages with < 50 characters (configurable) are OCR'd
4. **Content Merging**: Combines text-extracted and OCR'd pages seamlessly

#### For Images:
- Direct OCR processing using Tesseract.js

## Configuration

### Environment Variables

Add these to `collector/.env`:

```bash
# Character threshold for scanned page detection
# Pages with fewer characters will trigger OCR
OCR_THRESHOLD=50

# Target language(s) for OCR (comma-separated)
OCR_LANGUAGE=eng

# Cache directory for Tesseract models
STORAGE_DIR=./storage
```

### Programmatic Options

When processing files via the collector API, you can pass OCR options:

```javascript
{
  ocr: {
    // Language codes (ISO 639-2)
    langList: "eng,deu,fra",  // English, German, French

    // Character threshold per page
    threshold: 50
  }
}
```

## Supported Languages

The OCR system supports 100+ languages. Common examples:

| Code | Language |
|------|----------|
| `eng` | English |
| `deu` | German |
| `fra` | French |
| `spa` | Spanish |
| `jpn` | Japanese |
| `chi_sim` | Chinese (Simplified) |
| `chi_tra` | Chinese (Traditional) |
| `ara` | Arabic |
| `hin` | Hindi |
| `rus` | Russian |
| `por` | Portuguese |
| `ita` | Italian |

See `collector/utils/OCRLoader/validLangs.js` for the complete list.

## Use Cases

### 1. Scanned Documents
Process old scanned contracts, receipts, or historical documents:
- Upload a scanned PDF
- OCR automatically extracts text
- Content becomes searchable in your knowledge base

### 2. Mixed Documents
Handle PDFs with both digital and scanned pages:
- Modern contracts with scanned signature pages
- Reports with embedded scanned images
- Mixed digital/analog document archives

### 3. Image-Based Content
Extract text from screenshots, photos of documents, or infographics:
- Upload PNG/JPG images
- OCR extracts all readable text
- Useful for mobile document capture

### 4. Multi-language Documents
Process documents in various languages:
- Set `langList: "eng,fra"` for bilingual docs
- Tesseract auto-detects and processes both languages
- Preserves original text layout

## Performance Considerations

### Processing Time
- **Text PDFs**: < 1 second per page
- **Scanned PDFs**: 2-5 seconds per page (depending on CPU)
- **Large Documents**: Use batch processing (default: 10 pages at a time)

### Resource Usage
- **CPU**: OCR is CPU-intensive, uses multiple workers
- **Memory**: ~100MB per worker
- **Storage**: Tesseract models cache (~50MB per language)

### Optimization Tips

1. **Adjust Worker Count**: Controlled automatically based on CPU cores (max 4)
2. **Batch Size**: Default is 10 pages, configurable in code
3. **Timeout**: Default 5 minutes, adjustable per document
4. **Language Models**: Only download languages you need

## Troubleshooting

### OCR Not Working?

**Problem**: PDF processes but no OCR occurs
- **Solution**: Check if pages actually need OCR (must have < 50 chars)
- **Fix**: Lower the `threshold` if needed

**Problem**: OCR timeout errors
- **Solution**: Large documents may exceed 5-minute limit
- **Fix**: Process in smaller batches or increase timeout

**Problem**: Poor OCR accuracy
- **Solution**: Image quality may be low
- **Fix**: Use higher-resolution scans (300 DPI recommended)

### Language Issues

**Problem**: Wrong language detected
- **Solution**: Tesseract defaults to English
- **Fix**: Explicitly set `langList` to target language(s)

**Problem**: Language model not found
- **Solution**: Models download on first use
- **Fix**: Ensure internet connection for initial download

### Memory Issues

**Problem**: Collector crashes on large PDFs
- **Solution**: Too many concurrent workers
- **Fix**: Reduce batch size or worker count in code

## Technical Details

### Architecture

```
PDF Upload → PDFLoader (text extraction)
              ↓
         Text Analysis (per page)
              ↓
         < threshold chars?
              ↓ Yes
         OCRLoader (Tesseract.js)
              ↓
         Merge Results
              ↓
         Return Combined Content
```

### Key Components

1. **PDFLoader** (`processSingleFile/convert/asPDF/PDFLoader/index.js`)
   - Extracts text from PDF pages using pdf.js
   - Skips pages without text content

2. **OCRLoader** (`utils/OCRLoader/index.js`)
   - Tesseract.js wrapper for OCR processing
   - Handles PDF-to-image conversion via Sharp
   - Manages worker pools for parallel processing

3. **asPDF** (`processSingleFile/convert/asPDF/index.js`)
   - Main orchestrator for PDF processing
   - Detects low-content pages
   - Coordinates text extraction + OCR

### Detection Logic

```javascript
// Per-page threshold check
const OCR_THRESHOLD = options?.ocr?.threshold || 50;
const textLength = doc.pageContent.trim().length;

if (textLength < OCR_THRESHOLD) {
  // Trigger OCR for this page
}
```

### Enhancement (New!)

The latest enhancement adds **mixed PDF support**:
- Previous: OCR only if ALL pages had no text
- Current: OCR individual pages with insufficient text
- Benefit: Handles real-world mixed documents properly

## Example Workflows

### Basic Usage (Auto-detect)
```bash
# Upload a PDF via collector API
# OCR happens automatically if needed
curl -X POST http://localhost:8888/process-file \
  -F "file=@scanned-document.pdf"
```

### With Language Option
```bash
# Process German document
curl -X POST http://localhost:8888/process-file \
  -F "file=@german-doc.pdf" \
  -F "options[ocr][langList]=deu"
```

### Mixed Document
```bash
# Contract with digital pages + scanned signature
# Pages 1-10: digital text (fast extraction)
# Page 11: scanned signature (OCR'd automatically)
curl -X POST http://localhost:8888/process-file \
  -F "file=@signed-contract.pdf"
```

## Best Practices

1. **Scan Quality**: Use 300 DPI for best OCR accuracy
2. **File Size**: Keep PDFs under 100 pages for optimal performance
3. **Language**: Always specify language if not English
4. **Testing**: Test with sample scans before bulk processing
5. **Monitoring**: Watch logs for OCR detection and timing

## Future Enhancements

Potential improvements on the roadmap:
- [ ] Per-page OCR (avoid re-processing entire PDF)
- [ ] OCR result caching
- [ ] Progress webhooks for long documents
- [ ] OCR quality presets (fast/balanced/accurate)
- [ ] PDF preprocessing (deskew, denoise)

## Related Files

- `collector/utils/OCRLoader/index.js` - OCR implementation
- `collector/processSingleFile/convert/asPDF/index.js` - PDF processor
- `collector/utils/OCRLoader/validLangs.js` - Language codes
- `collector/.env.example` - Configuration template

## Support

For issues or questions:
1. Check the logs for detailed OCR processing info
2. Review `ANYTHINGLLM-PDF-OCR-IMPLEMENTATION-GUIDE.md` for technical details
3. Open an issue on the GitHub repository

---

**Last Updated**: November 8, 2025
**Version**: 1.9.0+

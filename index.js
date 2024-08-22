const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const app = express();
const upload = multer({ dest: 'uploads/' });

const processFileContent = (content) => {
    return content.replace(/id="([^"]*)"/g, (match, p1) => {
        return `id="${p1.replace(/\./g, '_')}"`;
    }).replace(/href="([^"]*)"/g, (match, p1) => {

        const parts = p1.split('/');

        let filePart = parts.pop();

        let [fileNameWithAnchor, anchor] = filePart.split('#');

        const lastDotIndex = fileNameWithAnchor.lastIndexOf('.');

        if (lastDotIndex !== -1) {
            const fileName = fileNameWithAnchor.substring(0, lastDotIndex);

            const ext = fileNameWithAnchor.substring(lastDotIndex);

            if (ext === '.dita' || ext === '.ditamap' || ext === '.pdf' || ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.html') {
                fileNameWithAnchor = fileName.replace(/\./g, '_') + ext;
            } else {
                fileNameWithAnchor = fileNameWithAnchor.replace(/\./g, '_');
            }

        } else {
            fileNameWithAnchor = fileNameWithAnchor.replace(/\./g, '_');
        }

        filePart = anchor ? `${fileNameWithAnchor}#${anchor.replace(/\./g, '_')}` : fileNameWithAnchor;

        const modifiedParts = parts.map((part, index) => {
            if (index === 0 && part === "..") {
                return part; 
            }
            console.log(part);
    
            return part.replace(/\./g, '_').replace(/_dita/g, '.dita');
        });
    
        modifiedParts.push(filePart);

        return `href="${modifiedParts.join('/')}"`;
    });
};

const processFileName = (filename) => {
    const parts = filename.split('.');
    if (parts.length > 1) {
        const ext = parts.pop();
        return parts.join('_') + '.' + ext;
    }
    return filename.replace(/\./g, '_');
};

app.post('/process-IASB2024Zip', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    const originalFileName = path.parse(req.file.originalname).name;
    const uniqueId = Math.random().toString(36).substring(7);
    const zipPath = req.file.path;
    const outputZipDir = path.join(__dirname, `processed/${uniqueId}`);
    const outputZip = path.join(outputZipDir, `${originalFileName}.zip`);
    
    if (!fs.existsSync(outputZipDir)){
        fs.mkdirSync(outputZipDir, { recursive: true });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = fs.createWriteStream(outputZip);

    archive.pipe(output);

    fs.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', async (entry) => {
            const fileName = entry.path;
            const newFileName = processFileName(fileName);

            if (entry.type === 'File') {
                let content = '';
                entry.on('data', (chunk) => {
                    content += chunk;
                });
                entry.on('end', () => {
                    const processedContent = processFileContent(content);
                    archive.append(processedContent, { name: newFileName });
                });
            } else {
                entry.autodrain();
                archive.directory(entry.path, newFileName);
            }
        })
        .on('close', () => {
            archive.finalize();
            res.status(200).json({ 
                message: 'File processed successfully', 
                downloadUrl: `/download/${uniqueId}`, 
                originalFileName: `${originalFileName}.zip` 
            });
            fs.unlinkSync(zipPath); 
        });
});

app.get('/download/:id', (req, res) => {
    const uniqueId = req.params.id;
    const filePath = path.join(__dirname, 'processed', `${uniqueId}`);
    fs.readdir(filePath, (err, files) => {
        if (err || files.length === 0) {
            return res.status(404).json({ message: 'File not found' });
        }
      
        const fileName = files[0];
        const fullFilePath = path.join(filePath, fileName);

        res.download(fullFilePath, fileName, (err) => {
            if (err) {
                return res.status(500).json({ message: 'Error downloading file' });
            }

            fs.unlink(fullFilePath, (err) => {
                if (err) {
                    console.error(`Failed to delete file: ${fullFilePath}`, err);
                }

                fs.rmdir(filePath, (err) => {
                    if (err) {
                        console.error(`Failed to delete directory: ${filePath}`, err);
                    }
                });
            });
        });
    });
 
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

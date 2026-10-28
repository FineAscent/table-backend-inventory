import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
// NOTE: potrace-ts is loaded lazily inside rebuild3D() so a CDN failure can't kill the whole module

const API_BASE_URL = globalThis.API_BASE_URL || 'https://q5mv3u14v5.execute-api.us-east-1.amazonaws.com/Prod';
const getIdToken = () => (globalThis.getIdToken ? globalThis.getIdToken() : null);

const MAX_SOURCE_DIM = 512;

class AwardsApp {
    constructor() {
        this.container = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.controls = null;
        this.modelGroup = null;
        this.processedImageUrl = null;
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.depth = 20;
        this.extrude = true;
        this.texture = null;
        this.originalTexture = null;
        this.targetSize = 120;
        this.rebuildTimer = null;
        this.animating = false;
        this.animId = null;
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.setupScene();
        this.observeVisibility();
        this.startAnimation();
        this.loadLibrary();
        // Defer first resize until the browser has painted (handles initially-visible panel)
        requestAnimationFrame(() => this.onResize());
    }

    cacheElements() {
        this.container = document.getElementById('awards-canvas-container');
        this.fileInput = document.getElementById('awards-file');
        this.dropzone = document.getElementById('awards-dropzone');
        this.nameInput = document.getElementById('awards-name');
        this.depthInput = document.getElementById('awards-depth');
        this.depthValue = document.getElementById('awards-depth-value');
        this.extrudeInput = document.getElementById('awards-extrude');
        this.saveBtn = document.getElementById('awards-save');
        this.status = document.getElementById('awards-status');
        this.libraryGrid = document.getElementById('awards-library-grid');
        this.panel = document.getElementById('panel-awards');
    }

    bindEvents() {
        this.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropzone.classList.add('dragover');
        });
        this.dropzone.addEventListener('dragleave', () => this.dropzone.classList.remove('dragover'));
        this.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropzone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) this.handleFile(file);
        });
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleFile(file);
        });
        this.depthInput.addEventListener('input', () => {
            this.depth = parseInt(this.depthInput.value, 10);
            this.depthValue.textContent = this.depth;
            this.debounceRebuild();
        });
        this.extrudeInput.addEventListener('change', () => {
            this.extrude = this.extrudeInput.checked;
            this.depthInput.disabled = !this.extrude;
            this.debounceRebuild();
        });
        this.saveBtn.addEventListener('click', () => this.saveToLibrary());
        window.addEventListener('resize', () => this.onResize());
    }

    setupScene() {
        if (!this.container) return;
        const width = this.container.clientWidth || 400;
        const height = this.container.clientHeight || 400;

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf8fafc);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
        this.camera.position.set(0, 0, 220);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 50;
        this.controls.maxDistance = 500;

        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        pmremGenerator.dispose();

        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(60, 100, 60);
        this.scene.add(dir);

        const fill = new THREE.DirectionalLight(0xffffff, 0.6);
        fill.position.set(-60, 20, 60);
        this.scene.add(fill);
    }

    animate() {
        if (!this.renderer || !this.animating) return;
        this.animId = requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    startAnimation() {
        if (this.animating) return;
        this.animating = true;
        this.animate();
    }

    stopAnimation() {
        this.animating = false;
        if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    }

    observeVisibility() {
        if (!this.panel) return;
        const check = () => {
            const visible = this.panel.style.display !== 'none';
            if (visible) {
                this.startAnimation();
                // Defer resize one frame so the browser computes layout first
                requestAnimationFrame(() => this.onResize());
            } else {
                this.stopAnimation();
            }
        };
        new MutationObserver(check).observe(this.panel, { attributes: true, attributeFilter: ['style'] });
    }

    onResize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const w = this.container.clientWidth || 400;
        const h = this.container.clientHeight || 400;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    setStatus(msg, isError = false) {
        if (!this.status) return;
        this.status.textContent = msg;
        this.status.style.color = isError ? '#ef4444' : '#64748b';
    }

    async handleFile(file) {
        try {
            this.setStatus('Processing image…');
            this.saveBtn.disabled = true;
            const originalUrl = await this.readFileAsDataUrl(file);
            const processedUrl = await this.removeBackground(originalUrl);
            this.processedImageUrl = processedUrl;

            // Show thumbnail in dropzone
            const fi = this.fileInput;
            this.dropzone.innerHTML = '';
            const thumb = document.createElement('img');
            thumb.src = processedUrl || originalUrl;
            thumb.style.cssText = 'max-height:72px;max-width:100%;object-fit:contain;border-radius:4px;margin-bottom:6px;display:block;margin-left:auto;margin-right:auto;';
            const cap = document.createElement('p');
            cap.style.margin = '0'; cap.textContent = file.name;
            this.dropzone.appendChild(fi);
            this.dropzone.appendChild(thumb);
            this.dropzone.appendChild(cap);

            // processed texture (transparent bg) — used for SVG extrusion front face
            this.texture = await new Promise((resolve, reject) => {
                new THREE.TextureLoader().load(processedUrl, resolve, undefined, reject);
            });
            this.texture.colorSpace = THREE.SRGBColorSpace;
            this.texture.flipY = true;

            // original texture (white bg preserved) — used for plaque fallback so image is visible
            this.originalTexture = await new Promise((resolve, reject) => {
                new THREE.TextureLoader().load(originalUrl, resolve, undefined, reject);
            });
            this.originalTexture.colorSpace = THREE.SRGBColorSpace;
            this.originalTexture.flipY = true;
            await this.rebuild3D();
            this.saveBtn.disabled = false;
        } catch (err) {
            console.error(err);
            this.setStatus('Failed to process image: ' + err.message, true);
        }
    }

    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    removeBackground(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const scale = Math.min(1, MAX_SOURCE_DIM / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * scale));
                    const h = Math.max(1, Math.round(img.height * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, w, h);
                    const imageData = ctx.getImageData(0, 0, w, h);
                    const data = imageData.data;

                    // BUG FIX: sample all 4 corners (3×3 each) for robust background detection
                    const cornerSamples = [];
                    const sc = (cx, cy) => {
                        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
                            const px = Math.min(cx + dx, w - 1), py = Math.min(cy + dy, h - 1);
                            const idx = (py * w + px) * 4;
                            if (data[idx + 3] > 64) cornerSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
                        }
                    };
                    sc(0, 0); sc(w - 3, 0); sc(0, h - 3); sc(w - 3, h - 3);
                    const n = Math.max(cornerSamples.length, 1);
                    const br = cornerSamples.reduce((s, c) => s + c[0], 0) / n;
                    const bg = cornerSamples.reduce((s, c) => s + c[1], 0) / n;
                    const bb = cornerSamples.reduce((s, c) => s + c[2], 0) / n;

                    const threshold = 55 * 3;
                    for (let i = 0; i < data.length; i += 4) {
                        const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
                        if (d < threshold) data[i + 3] = 0;
                    }
                    ctx.putImageData(imageData, 0, 0);
                    this.imageWidth = w;
                    this.imageHeight = h;
                    resolve(canvas.toDataURL('image/png'));
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    createMaskDataUrl(processedUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    const a = data[i + 3];
                    if (a < 128) {
                        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
                    } else {
                        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = processedUrl;
        });
    }

    debounceRebuild() {
        if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => this.rebuild3D(), 100);
    }

    async rebuild3D() {
        if (!this.processedImageUrl || !this.texture) return;
        this.setStatus('Building 3D model…');
        let built = false;
        try {
            // Lazy import: if the CDN is unavailable the catch below handles it gracefully
            const { traceDataUrl, getSVG } = await import('https://esm.sh/@cadit-app/potrace-ts');
            const maskUrl = await this.createMaskDataUrl(this.processedImageUrl);
            const paths = await traceDataUrl(maskUrl);
            const svgString = getSVG(paths, 1);
            built = this.setModelFromSVG(svgString);
        } catch (traceErr) {
            console.warn('Vector trace failed — falling back to plaque:', traceErr.message || traceErr);
        }
        if (!built) this.buildPlaque();
        this.setStatus('3D preview ready — drag to rotate, scroll to zoom.');
    }

    clearGroup() {
        if (!this.modelGroup) return;
        this.scene.remove(this.modelGroup);
        this.modelGroup.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
            }
        });
        this.modelGroup = null;
    }

    makeMaterials() {
        const depth = this.extrude ? Math.max(0.1, this.depth) : 0.1;
        return {
            depth,
            front: new THREE.MeshStandardMaterial({
                map: this.texture, metalness: 0.05, roughness: 0.55,
                side: THREE.FrontSide,
                transparent: true,   // respect alpha channel from background-removed image
                alphaTest: 0.05      // discard near-fully-transparent pixels cleanly
            }),
            side: new THREE.MeshStandardMaterial({
                color: 0xffd700, metalness: 0.9, roughness: 0.12,
                side: THREE.FrontSide
            })
        };
    }

    setModelFromSVG(svgString) {
        this.clearGroup();
        const { front: frontMaterial, side: sideMaterial, depth } = this.makeMaterials();
        const loader = new SVGLoader();
        const svgData = loader.parse(svgString);
        const group = new THREE.Group();

        const extrudeSettings = {
            steps: 1, depth,
            bevelEnabled: true, bevelThickness: 1, bevelSize: 0.5,
            bevelSegments: 2, curveSegments: 8
        };

        const meshes = [];
        svgData.paths.forEach((path) => {
            SVGLoader.createShapes(path).forEach((shape) => {
                const mesh = new THREE.Mesh(
                    new THREE.ExtrudeGeometry(shape, extrudeSettings),
                    [frontMaterial, sideMaterial]
                );
                group.add(mesh);
                meshes.push(mesh);
            });
        });

        if (meshes.length === 0) return false; // BUG FIX: return false so caller can fall back

        const globalBox = new THREE.Box3();
        meshes.forEach((m) => globalBox.expandByObject(m));
        const size = new THREE.Vector3(); globalBox.getSize(size);
        const min = globalBox.min;

        // UV mapping: SVG y goes down, texture V=1 is image top with flipY=true
        // So v = 1 - (y-min)/size is correct and consistent with flipY=true
        meshes.forEach((mesh) => {
            const pos = mesh.geometry.attributes.position;
            const uv  = mesh.geometry.attributes.uv;
            for (let i = 0; i < pos.count; i++) {
                const u = size.x > 0 ? (pos.getX(i) - min.x) / size.x : 0;
                const v = size.y > 0 ? (pos.getY(i) - min.y) / size.y : 0;
                uv.setXY(i, u, 1 - v); // 1-v: SVG top (v=0) maps to image top (1-0=1, then flipY makes it top)
            }
            uv.needsUpdate = true;
        });

        const maxDim = Math.max(size.x, size.y, 1);
        const scale  = this.targetSize / maxDim;

        // BUG FIX: negate Y scale to flip SVG (Y-down) into Three.js space (Y-up)
        group.scale.set(scale, -scale, 1);

        // BUG FIX: centering with negative Y scale means position.y is POSITIVE
        const center = new THREE.Vector3(); globalBox.getCenter(center);
        group.position.set(-center.x * scale, center.y * scale, -depth / 2);

        this.scene.add(group);
        this.modelGroup = group;
        this.fitCameraToGroup(group);
        return true; // BUG FIX: signal success
    }

    buildPlaque() {
        this.clearGroup();
        const { side: sideMat, depth } = this.makeMaterials();
        // Use original image (white bg) so the logo is clearly visible on the plaque face
        const faceTex = this.originalTexture || this.texture;
        const frontMat = new THREE.MeshStandardMaterial({
            map: faceTex, metalness: 0.05, roughness: 0.55, side: THREE.FrontSide
        });
        const aspect = this.imageWidth / Math.max(this.imageHeight, 1) || 1;
        const h = this.targetSize, w = h * aspect;
        // BoxGeometry face material order: +x, -x, +y, -y, +z (front), -z (back)
        const materials = [sideMat, sideMat, sideMat, sideMat, frontMat, frontMat];
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), materials);
        const group = new THREE.Group();
        group.add(mesh);
        this.scene.add(group);
        this.modelGroup = group;
        this.fitCameraToGroup(group);
    }

    fitCameraToGroup(group) {
        const box = new THREE.Box3().setFromObject(group);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.6;
        this.controls.target.copy(center);
        this.camera.position.set(center.x, center.y, center.z + Math.max(dist, 80));
        this.camera.near = 0.1;
        this.camera.far = Math.max(dist * 5, 1000);
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    async saveToLibrary() {
        if (!this.modelGroup || !this.processedImageUrl) return;
        const name = this.nameInput.value.trim() || 'Award';
        this.setStatus('Saving award...');
        this.saveBtn.disabled = true;
        try {
            const glbBlob = await this.exportGLB();
            const folderId = this.generateId();
            const sourceBlob = await (await fetch(this.processedImageUrl)).blob();
            const sourceKey = await this.uploadBlob(sourceBlob, 'image/png', `awards/${folderId}`, 'source.png');
            const modelKey = await this.uploadBlob(glbBlob, 'model/gltf-binary', `awards/${folderId}`, 'model.glb');
            await this.createAward({ name, sourceImageKey: sourceKey, modelKey });
            this.setStatus('Award saved!');
            this.nameInput.value = '';
            this.loadLibrary();
        } catch (err) {
            console.error(err);
            this.setStatus('Save failed: ' + err.message, true);
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    exportGLB() {
        return new Promise((resolve, reject) => {
            const exporter = new GLTFExporter();
            exporter.parse(
                this.modelGroup,
                (gltf) => {
                    if (gltf instanceof ArrayBuffer) {
                        resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
                    } else {
                        reject(new Error('GLB export did not return binary'));
                    }
                },
                (err) => reject(err),
                { binary: true, forcePowerOfTwoTextures: false }
            );
        });
    }

    async uploadBlob(blob, contentType, folder, fileName) {
        const { uploadUrl, key } = await this.getUploadUrl({ fileName, contentType, folder });
        const resp = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Upload failed ${resp.status}: ${t}`);
        }
        return key;
    }

    async getUploadUrl({ fileName, contentType, folder }) {
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${API_BASE_URL}/upload-url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ fileName, contentType, folder })
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Upload URL failed ${resp.status}: ${t}`);
        }
        return resp.json();
    }

    async createAward({ name, sourceImageKey, modelKey }) {
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${API_BASE_URL}/awards`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, sourceImageKey, modelKey })
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Save failed ${resp.status}: ${t}`);
        }
        return resp.json();
    }

    async loadLibrary() {
        try {
            const resp = await fetch(`${API_BASE_URL}/awards`);
            if (!resp.ok) throw new Error('Failed to load library');
            const data = await resp.json();
            this.renderLibrary(data.items || []);
        } catch (err) {
            this.libraryGrid.innerHTML = `<p class="awards-empty">Could not load library: ${err.message}</p>`;
        }
    }

    renderLibrary(items) {
        if (!items.length) {
            this.libraryGrid.innerHTML = '<p class="awards-empty">No awards saved yet.</p>';
            return;
        }
        this.libraryGrid.innerHTML = items.map((item) => `
            <div class="awards-card" data-id="${item.id}">
                <div class="awards-card-thumb">
                    <img src="" alt="${this.escapeHtml(item.name)}" class="awards-thumb-img" data-key="${item.sourceImageKey}">
                </div>
                <div class="awards-card-info">
                    <div class="awards-card-name">${this.escapeHtml(item.name)}</div>
                    <div class="awards-card-date">${new Date(item.createdAt).toLocaleDateString()}</div>
                </div>
                <div class="awards-card-actions">
                    <button class="awards-btn-download" data-key="${item.modelKey}" title="Download .glb">Download</button>
                    <button class="awards-btn-delete" data-id="${item.id}" title="Delete">Delete</button>
                </div>
            </div>
        `).join('');
        this.libraryGrid.querySelectorAll('.awards-thumb-img').forEach(async (img) => {
            try {
                const url = await this.getSignedUrl(img.dataset.key);
                img.src = url;
            } catch (e) {
                img.alt = 'No preview';
            }
        });
        this.libraryGrid.querySelectorAll('.awards-btn-download').forEach((btn) => {
            btn.addEventListener('click', () => this.downloadModel(btn.dataset.key));
        });
        this.libraryGrid.querySelectorAll('.awards-btn-delete').forEach((btn) => {
            btn.addEventListener('click', () => this.deleteAward(btn.dataset.id));
        });
    }

    async getSignedUrl(key) {
        const headers = { 'Content-Type': 'application/json' };
        const token = getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${API_BASE_URL}/image-url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ key })
        });
        if (!resp.ok) throw new Error('Signed URL failed');
        const data = await resp.json();
        return data.url;
    }

    async downloadModel(key) {
        try {
            const url = await this.getSignedUrl(key);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'award.glb';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err) {
            this.setStatus('Download failed: ' + err.message, true);
        }
    }

    async deleteAward(id) {
        if (!confirm('Delete this award?')) return;
        try {
            const headers = {};
            const token = getIdToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const resp = await fetch(`${API_BASE_URL}/awards/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
            if (!resp.ok) throw new Error('Delete failed');
            this.loadLibrary();
        } catch (err) {
            this.setStatus('Delete failed: ' + err.message, true);
        }
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    generateId() {
        return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

const app = new AwardsApp();
// BUG FIX: module scripts are deferred; DOMContentLoaded may have already fired
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}
globalThis.awardsApp = app;


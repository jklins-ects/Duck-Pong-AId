import * as THREE from "three";
//import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const COURT = {
    width: 20,
    height: 8,
    depth: 40,
    p1z: -18,
    p2z: 18,
};

function normalizeColor(name) {
    const map = {
        yellow: "#f3d33b",
        orange: "#f28c28",
        blue: "#4080ff",
        green: "#44aa55",
        red: "#dd4444",
        white: "#f5f5f5",
        black: "#111111",
        lightblue: "#8fd3ff",
        purple: "#8b5cf6",
        pink: "#ff7ac8",
        brown: "#8b5a2b",
    };

    return map[String(name || "").toLowerCase()] || name || "yellow";
}

export class GameScene {
    constructor(containerEl, localSide = "p1", modelBaseUrl = "/models/") {
        this.containerEl = containerEl;
        this.modelBaseUrl = modelBaseUrl;
        this.localSide = localSide;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x101418);

        const w = this.containerEl.clientWidth;
        const h = this.containerEl.clientHeight;

        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
        this.camera.position.set(0, 14, 30);

        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(1);
        this.containerEl.appendChild(this.renderer.domElement);

        this.players = {
            p1: { group: new THREE.Group(), duck: null, shield: null },
            p2: { group: new THREE.Group(), duck: null, shield: null },
        };

        this.baseDuckObject = null;

        this.targets = {
            p1x: 0,
            p2x: 0,
            p1z: COURT.p1z,
            p2z: COURT.p2z,
            ball: new THREE.Vector3(0, 2, 0),
        };

        this._cameraTarget = new THREE.Vector3();
        this._cameraLookAt = new THREE.Vector3();

        this.ball = this.createBall();
        this.scene.add(this.ball);

        this.createLights();
        this.createCourt();

        this.scene.add(this.players.p1.group);
        this.scene.add(this.players.p2.group);

        this.players.p1.group.position.set(0, 0, COURT.p1z);
        this.players.p2.group.position.set(0, 0, COURT.p2z);

        this.players.p1.group.rotation.y = 0;
        this.players.p2.group.rotation.y = Math.PI;

        this.players.p1.shield = this.createShield(1.5);
        this.players.p2.shield = this.createShield(1.5);

        this.players.p1.group.add(this.players.p1.shield);
        this.players.p2.group.add(this.players.p2.shield);

        this.players.p1.group.visible = false;
        this.players.p2.group.visible = false;

        this.listenResize();
        this.startLoop();
    }

    createShield(radius = 1.5) {
        const shield = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, 0.15, 10),
            new THREE.MeshStandardMaterial({
                color: 0x7fd6ff,
                transparent: true,
                opacity: 0.45,
                emissive: 0x1a3a4a,
                metalness: 0.15,
                roughness: 0.35,
            }),
        );

        shield.rotation.x = Math.PI / 2;
        shield.position.set(0, 1.8, 1.2);

        return shield;
    }

    createLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

        const light1 = new THREE.DirectionalLight(0xffffff, 1.1);
        light1.position.set(10, 15, 10);
        this.scene.add(light1);

        const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
        light2.position.set(-10, 8, -8);
        this.scene.add(light2);
    }

    createCourt() {
        const floorGeo = new THREE.BoxGeometry(COURT.width, 0.5, COURT.depth);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x254a2b });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.y = 0;
        this.scene.add(floor);

        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

        const centerLine = new THREE.Mesh(
            new THREE.BoxGeometry(COURT.width, 0.05, 0.2),
            lineMat,
        );
        centerLine.position.set(0, 0.28, 0);
        this.scene.add(centerLine);

        const leftWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 3, COURT.depth),
            new THREE.MeshStandardMaterial({
                color: 0x333b44,
                transparent: true,
                opacity: 0.45,
            }),
        );
        leftWall.position.set(-COURT.width / 2, 1.5, 0);
        this.scene.add(leftWall);

        const rightWall = leftWall.clone();
        rightWall.position.x = COURT.width / 2;
        this.scene.add(rightWall);

        const backFrame1 = new THREE.Mesh(
            new THREE.BoxGeometry(COURT.width, 3, 0.2),
            new THREE.MeshStandardMaterial({
                color: 0x444444,
                transparent: true,
                opacity: 0.25,
            }),
        );
        backFrame1.position.set(0, 1.5, -COURT.depth / 2);
        this.scene.add(backFrame1);

        const backFrame2 = backFrame1.clone();
        backFrame2.position.z = COURT.depth / 2;
        this.scene.add(backFrame2);
    }

    createBall() {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.45, 12, 12),
            new THREE.MeshStandardMaterial({ color: 0xfff067 }),
        );
        mesh.position.set(0, 2, 0);
        return mesh;
    }

    listenResize() {
        const onResize = () => {
            const w = this.containerEl.clientWidth;
            const h = this.containerEl.clientHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
            this.renderer.setPixelRatio(1);
        };

        window.addEventListener("resize", onResize);
        this._cleanupResize = () =>
            window.removeEventListener("resize", onResize);
    }

    startLoop() {
        const tick = () => {
            this.players.p1.group.position.x = THREE.MathUtils.lerp(
                this.players.p1.group.position.x,
                this.targets.p1x,
                0.4,
            );
            this.players.p2.group.position.x = THREE.MathUtils.lerp(
                this.players.p2.group.position.x,
                this.targets.p2x,
                0.4,
            );

            this.players.p1.group.position.z = THREE.MathUtils.lerp(
                this.players.p1.group.position.z,
                this.targets.p1z,
                0.08,
            );
            this.players.p2.group.position.z = THREE.MathUtils.lerp(
                this.players.p2.group.position.z,
                this.targets.p2z,
                0.08,
            );

            this.ball.position.lerp(this.targets.ball, 0.25);

            if (this.ball) {
                this.ball.rotation.x += 0.15;
                this.ball.rotation.z += 0.1;
            }

            this.renderer.render(this.scene, this.camera);
            this._animHandle = requestAnimationFrame(tick);
        };

        tick();
    }

    updateCameraFromState(state) {
        if (!state) return;

        const localPlayer = state.players[this.localSide];
        if (!localPlayer) return;

        const isP1 = this.localSide === "p1";

        const targetX = localPlayer.x * 0.15;
        const targetY = 4.2;
        const targetZ = isP1 ? 2 : -2;

        const cameraX = localPlayer.x * 0.2;
        const cameraY = 8.5;
        const cameraZ = isP1 ? -34 : 34;

        this._cameraTarget.set(cameraX, cameraY, cameraZ);
        this._cameraLookAt.set(targetX, targetY, targetZ);

        if (!this._cameraInitialized) {
            this.camera.position.copy(this._cameraTarget);
            this._cameraInitialized = true;
        } else {
            this.camera.position.lerp(this._cameraTarget, 0.18);
        }

        this.camera.lookAt(this._cameraLookAt);
    }

    async loadBaseDuckModel() {
        if (this.baseDuckObject) return this.baseDuckObject;

        const loader = new GLTFLoader();

        const gltf = await new Promise((resolve, reject) => {
            loader.load(
                `${this.modelBaseUrl}duck.1.glb`,
                resolve,
                undefined,
                reject,
            );
        });

        const obj = gltf.scene;

        const box1 = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box1.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2.4 / maxDim;
        obj.scale.setScalar(scale);

        const box2 = new THREE.Box3().setFromObject(obj);
        const center = new THREE.Vector3();
        box2.getCenter(center);
        obj.position.sub(center);
        obj.position.y += 1.2;

        obj.traverse((child) => {
            if (!child.isMesh) return;

            child.castShadow = false;
            child.receiveShadow = false;
        });

        this.baseDuckObject = obj;
        return obj;
    }

    resolveColorKey(child, material) {
        const materialName = String(material?.name || "").toLowerCase();
        const childName = String(child?.name || "").toLowerCase();
        const name = `${childName} ${materialName}`;

        if (name.includes("head")) return "head";
        if (name.includes("front_left")) return "front_left";
        if (name.includes("frontleft")) return "front_left";
        if (name.includes("front right")) return "front_right";
        if (name.includes("front_right")) return "front_right";
        if (name.includes("frontright")) return "front_right";
        if (name.includes("rear_left")) return "rear_left";
        if (name.includes("rearleft")) return "rear_left";
        if (name.includes("rear right")) return "rear_right";
        if (name.includes("rear_right")) return "rear_right";
        if (name.includes("rearright")) return "rear_right";
        if (name.includes("beak") || name.includes("bill")) return "beak";
        if (name.includes("eye") || name.includes("pupil")) return "eyes";

        return "head";
    }

    applyDuckColors(obj, duck) {
        const isDerpy = !!duck.derpy;

        const duckColors = {
            head: duck.body?.head ?? "yellow",
            front_left: duck.body?.frontLeft ?? duck.body?.front1 ?? "yellow",
            front_right: duck.body?.frontRight ?? duck.body?.front2 ?? "yellow",
            rear_left: duck.body?.rearLeft ?? duck.body?.back1 ?? "yellow",
            rear_right: duck.body?.rearRight ?? duck.body?.back2 ?? "yellow",
            eyes: isDerpy ? "white" : "black",
            beak: "orange",
        };

        obj.traverse((child) => {
            if (!child.isMesh) return;

            const setColor = (mat) => {
                if (!mat?.color) return;

                const key = this.resolveColorKey(child, mat);
                const chosen = duckColors[key] ?? "yellow";
                mat.color.set(normalizeColor(chosen));

                if ("metalness" in mat) mat.metalness = 0;
                if ("roughness" in mat) mat.roughness = 1;
            };

            if (Array.isArray(child.material)) {
                child.material.forEach(setColor);
            } else {
                setColor(child.material);
            }
        });
    }

    async setPlayerDuck(side, duck) {
        const base = await this.loadBaseDuckModel();
        const clone = base.clone(true);

        clone.traverse((child) => {
            if (!child.isMesh) return;

            if (Array.isArray(child.material)) {
                child.material = child.material.map((m) => m.clone());
            } else if (child.material) {
                child.material = child.material.clone();
            }

            child.castShadow = false;
            child.receiveShadow = false;
        });

        this.applyDuckColors(clone, duck);

        const slot = this.players[side];
        const shield = slot.shield;

        slot.group.clear();
        slot.group.add(clone);

        if (shield) {
            slot.group.add(shield);
        }

        slot.duck = duck;
        slot.group.visible = true;
    }

    setShieldRadius(side, radius) {
        const shield = this.players[side]?.shield;
        if (!shield) return;

        const currentBaseRadius = 1.5;
        const scale = radius / currentBaseRadius;

        shield.scale.set(scale, 1, scale);
    }

    updateState(state) {
        if (!state) return;

        this.setShieldRadius("p1", state.players.p1.shieldRadius ?? 1.5);
        this.setShieldRadius("p2", state.players.p2.shieldRadius ?? 1.5);

        this.targets.p1x = state.players.p1.x;
        this.targets.p2x = state.players.p2.x;

        this.targets.ball.set(state.ball.x, state.ball.y, state.ball.z);

        this.targets.p1z = state.players.p1.chaseTimer > 0 ? -8 : COURT.p1z;
        this.targets.p2z = state.players.p2.chaseTimer > 0 ? 8 : COURT.p2z;

        this.updateCameraFromState(state);
    }

    setPlayerVisible(side, visible) {
        if (!this.players[side]) return;
        this.players[side].group.visible = visible;
    }

    destroy() {
        if (this._animHandle) cancelAnimationFrame(this._animHandle);
        if (this._cleanupResize) this._cleanupResize();
        this.renderer.dispose();
        this.containerEl.innerHTML = "";
    }
}

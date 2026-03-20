import { GameScene } from "./scene.js";

export class DuckTennisGameClient {
    constructor(containerEl, localSide = "p1") {
        this.containerEl = containerEl;
        this.scene = new GameScene(containerEl, localSide);
        this.loadedDuckIds = {
            p1: null,
            p2: null,
        };
    }

    async syncRoomState(roomState) {
        const p1Duck = roomState.players.p1.duck;
        const p2Duck = roomState.players.p2.duck;

        if (p1Duck) {
            const p1Id =
                p1Duck._id ?? p1Duck.id ?? p1Duck.duck_id ?? p1Duck.duckId;
            if (this.loadedDuckIds.p1 !== p1Id) {
                await this.scene.setPlayerDuck("p1", p1Duck);
                this.loadedDuckIds.p1 = p1Id;
            }
            this.scene.setPlayerVisible("p1", true);
        } else {
            this.scene.setPlayerVisible("p1", false);
            this.loadedDuckIds.p1 = null;
        }

        if (p2Duck) {
            const p2Id =
                p2Duck._id ?? p2Duck.id ?? p2Duck.duck_id ?? p2Duck.duckId;
            if (this.loadedDuckIds.p2 !== p2Id) {
                await this.scene.setPlayerDuck("p2", p2Duck);
                this.loadedDuckIds.p2 = p2Id;
            }
            this.scene.setPlayerVisible("p2", true);
        } else {
            this.scene.setPlayerVisible("p2", false);
            this.loadedDuckIds.p2 = null;
        }

        this.scene.updateState(roomState);
    }
}

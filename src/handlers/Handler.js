const { App } = require("@slack/bolt");

class Handler {
    /**
     * @param {App} app
     */
    constructor(app) {
        this.app = app;
    }

    static shouldHandle(request) {
        throw new Error("Not implemented");
    }

    async handle(request) {
        throw new Error("Not implemented");
    }
}

module.exports = Handler;

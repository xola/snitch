import Bolt from "@slack/bolt";
import config from "config";
import { json } from "express";
import { isEmpty } from "lodash-es";
import serverless from "serverless-http";

import AgentHandler from "./handlers/AgentHandler.js";
import PipelineUpdateHandler from "./handlers/PipelineUpdateHandler.js";
import Pipeline from "./models/Pipeline.js";
import Go from "./services/go.js";

const slack = config.get("slack");
if (isEmpty(slack.token) || isEmpty(slack.signingSecret)) {
    console.log(`ERROR: 'slack.token' or 'slack.signingSecret' is not provided`);
    console.log(JSON.stringify(slack, null, 2));
    process.exit(1);
}

const go = config.get("go");
if (isEmpty(go.username) || isEmpty(go.password)) {
    console.log(`ERROR: 'go.username' or 'go.password' is not provided`);
    console.log(JSON.stringify(go, null, 2));
    process.exit(1);
}

const receiver = new Bolt.ExpressReceiver({
    signingSecret: slack.signingSecret,
});

const app = new Bolt.App({
    token: slack.token,
    signingSecret: slack.signingSecret,
    receiver,
    // logLevel: LogLevel.DEBUG,
});

app.action({ callback_id: "build_response" }, async ({ action, say, ack }) => {
    console.log("build_response with action", action);
    await ack(); // Tell them we received this
    const payload = JSON.parse(action.value);

    let msg = "Error, invalid payload";
    if (action.name === "rerun") {
        const result = await runFailedJobs(payload.uri);
        msg = `${result?.message || "Error triggering build"} for ${payload.name}`;
    }

    if (action.name === "output" && payload.jobs?.length > 0) {
        const [pipelineData, stageHistory] = await Promise.all([
            Go.fetchPipelineInstance(payload.name),
            Go.fetchStageHistory(payload.pipeline, payload.stage),
        ]);
        if (pipelineData && stageHistory.stages) {
            pipelineData.stage = stageHistory.stages.find((s) => s.counter == payload.counter);
            const pipeline = new Pipeline(pipelineData);
            const handler = new PipelineUpdateHandler();
            await handler.parseFailures(pipeline, true);
            msg = pipeline.get("failures") ? `Detail error output\n` : "Error processing failures";
            pipeline.get("failures")?.forEach((failure) => {
                const failureMsg = failure.replace(/^\s*\n/gm, ""); // Trim empty lines
                msg += "```" + failureMsg + "``` ";
            });
        }
    }

    await say(msg);
});

const handlers = [PipelineUpdateHandler, AgentHandler];

receiver.router.get("/status", async (request, response) => {
    response.send({ status: "SNITCH - OK" });
});

receiver.router.post("/api/webhooks", json(), async (request, response) => {
    const Handler = handlers.find((Handler) => {
        return Handler.shouldHandle(request);
    });

    if (Handler) {
        await new Handler(app).handle(request).catch((error) => {
            console.error(error);
        });
    }

    response.send({ status: "OK" });
});

receiver.router.post("/api/actions", json(), async (request, response) => {
    console.log(request.body);
});

if (!process.env.IS_SERVERLESS) {
    app.start(config.get("port")).then(() => {
        console.log(`🚀 Snitch started on port ${config.get("port")} GoCD ${go.url} Node ${process.version}`);
    });
}

const appHandler = serverless(receiver.app);

const handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    return appHandler(event, context);
};

export default handler;

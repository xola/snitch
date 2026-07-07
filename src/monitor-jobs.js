import chalk from "chalk";
import { CronJob } from "cron";
import dayjs from "dayjs";
import { getElasticAgentsInfo } from "./services/elastic-agents.js";
import Go from "./services/go.js";
import { notify } from "./services/slack.js";

const now = () => dayjs().format("HH:mm:ss");
const messagesToSkip = [/Modification check failed/];
const pad = (value) => String(value).padStart(2, " ");

async function check() {
    const data = await Go.fetchServerHealth();
    if (!data.length) {
        process.stdout.write(".");
        return;
    }

    if (data.length > 1) {
        console.log(`${now()} Found ${data.length} warnings`);
    }
    const spacer = " ".repeat(now().length);

    let counter = 0;
    const pipelinesProcessed = [];

    const NOTIFY_MAX_MINUTES = 10;
    const pipelineMap = {};

    data.forEach((info) => {
        const re = new RegExp(/\b[A-Z0-9]{2,5}-\d{1,5}\b/, "gmi");
        const branchRe = new RegExp(/\bBranch: (.*$)\b/, "gmi");
        const ticketNumber = info.message.match(re)?.[0] ?? info.message.match(branchRe)?.[0];

        for (const re of messagesToSkip) {
            if (re.test(info.message)) {
                console.log(spacer, `${++counter} Skipped ${ticketNumber}`);
                if (!ticketNumber) {
                    console.log(spacer, info.message, info.detail);
                }
                return;
            }
        }

        const duration = info.detail.match(/in the last ([0-9]+) minute/);
        const pipelineMatch = info.message.match(/Job '(.*)' is not responding/);
        // console.log(spacer, `${++counter} ${info.level}`, info.message);
        if (pipelineMatch && duration && duration[1]) {
            const minutes = Number(duration[1]);
            if (minutes > NOTIFY_MAX_MINUTES) {
                const name = pipelineMatch[1].split("/")?.[0] ?? pipelineMatch[1];
                if (!pipelineMap[name]) {
                    console.log(spacer, `${ticketNumber} Pipeline ${name} waiting for ${chalk.red(minutes)} minutes`);
                    pipelineMap[name] = { name, minutes, count: 0, pipelines: [] };
                }
                pipelineMap[name].count += 1;
                pipelineMap[name].pipelines.push(pipelineMatch[1]);
                pipelinesProcessed.push(name);
                ticketNumber && pipelinesProcessed.push(ticketNumber);
            }
        } else {
            console.log(spacer, chalk.dim(info.detail));
        }
    });

    const pad = (count) => `${String(count).padStart(2, " ")}`;

    let message = "";
    let totalJobs = 0;
    const totalPipelines = Object.keys(pipelineMap).length;
    for (const pipeline in pipelineMap) {
        const { name, count, minutes } = pipelineMap[pipeline];
        message += `Stuck for *${pad(minutes)}* minutes: *${pad(count)}* x <https://sage.ci.xola.com/go/pipelines#!/${name}|${name}> jobs.\n`;
        totalJobs += count;
    }

    if (totalPipelines > 0) {
        const header = `*${totalJobs} affected jobs* across ${totalPipelines} pipelines. <https://sage.ci.xola.com/go/admin/status_reports/com.thoughtworks.gocd.elastic-agent.ecs/cluster/CI|See overview>.`;
        const { tasks, instances, errorMessages } = await getElasticAgentsInfo();
        const attachments = [
            {
                text: `Tasks:     _Pending:_ ${pad(tasks.pending)}        _Running:_ ${pad(tasks.running)}  = _${pad(tasks.total)} Total_`,
            },
            {
                text: `Instances:    _Spot:_ ${pad(instances.spot)} _On Demand:_ ${pad(instances.onDemand)}  = _${pad(instances.total)} Total_`,
            },
        ];
        if (errorMessages.header?.length > 0) {
            attachments.push({ text: `\n*${errorMessages.description}*\n\`\`\`${errorMessages.header}\`\`\`\n` });
        }
        await notify(`${header}\n\n${message}`, [], { username: "GoCD Snitch - Stuck Jobs", attachments });
    }

    console.log();
}

export const handler = async () => {
    await check();
};

if (process.argv[2] === "start") {
    const interval = process.argv[3] ?? 20;
    const expr = `*/${interval} * * * 1-5`; // */2 is every two minutes (see crontab.guru)
    console.log(`${now()} 🚀 Starting Cron Job for server health (${expr})`);
    check();
    const job = new CronJob(expr, check);
    job.start();
} else if (!process.env.IS_SERVERLESS) {
    check();
}

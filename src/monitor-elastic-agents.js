import chalk from "chalk";
import { CronJob } from "cron";
import dayjs from "dayjs";
import { getElasticAgentsInfo } from "./services/elastic-agents.js";
import { notify } from "./services/slack.js";

const now = () => dayjs().format("HH:mm:ss");

const MAX_PENDING_TASKS = 15;
const MAX_HOST_MACHINES = 40;

const pad = (value) => String(value).padStart(2, " ");

async function check() {
    const { tasks, instances, errorMessages } = await getElasticAgentsInfo();

    console.log(`GoCD Elastic Agent Status at ${now()}`);
    process.stdout.write(chalk.bold("    Tasks "));
    console.log(
        `Running: ${pad(tasks.running)}   Pending: ${pad(tasks.pending)}`,
        chalk.bold(`Total: ${pad(tasks.total)}`),
    );
    if (Number(tasks.pending) >= MAX_PENDING_TASKS) {
        console.log(chalk.bgRed.white.bold(`Too many pending tasks (${tasks.pending})`));
        await notify(
            `There are *${tasks.pending} pending tasks*. ${tasks.running} are running. Please check <https://sage.ci.xola.com/go/admin/status_reports/com.thoughtworks.gocd.elastic-agent.ecs/cluster/CI|GoCD Cluster Page> or the <https://us-east-1.console.aws.amazon.com/ecs/v2/home|ECS console>`,
            [],
            { username: "GoCD Snitch - Agents" },
        );
    }

    process.stdout.write(chalk.bold("Instances "));
    console.log(
        `Spot:    ${pad(instances.spot)} On Demand: ${pad(instances.onDemand)}`,
        chalk.bold(`Total: ${pad(instances.total)}`),
    );
    if (instances.total >= MAX_HOST_MACHINES) {
        console.log(chalk.bgGreen.white.bold(`Max limit reached: ${instances.total}/${MAX_HOST_MACHINES}`));
        // await notify(`Max limit of host machines reached: ${instances.total}/${MAX_HOST_MACHINES}. Nothing bad here, just FYI 👏🏼`);
    }

    if (errorMessages.header?.length > 0) {
        console.log(errorMessages.header);
        console.log(chalk.red(errorMessages.description));
        console.log();
        await notify(
            `*${errorMessages.description}*\n\`\`\`${errorMessages.header}\`\`\` Please check <https://sage.ci.xola.com/go/admin/status_reports/com.thoughtworks.gocd.elastic-agent.ecs/cluster/CI|GoCD Cluster Page> or the <https://us-east-1.console.aws.amazon.com/ecs/v2/home|ECS console>.`,
            [],
            { username: "GoCD Snitch - Agents" },
        );
    }

    console.log();
}

export const handler = async () => {
    await check();
};

if (process.argv[2] === "start") {
    const interval = process.argv[3] ?? 45;
    const expr = `*/${interval} * * * 1-5`; // */2 is every two minutes
    console.log(`${now()} 🚀 Starting Cron Job for agents health (${expr})`);
    check();
    const job = new CronJob(expr, check);
    job.start();
} else if (!process.env.IS_SERVERLESS) {
    check();
}

const { exec } = require('child_process');
const now = new Date();

async function loadConfig(env) {
    const config = await import('../src/config.js');
    return config.default(env);
}

async function runCommand(command) {
    await exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
    });
}


(async () => {
    var args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: node scripts/init-kv.cjs <local/remote> [date]');
        return;
    }

    let mode_arg = '';
    let environment = {};
    switch (args[0]) {
        case 'local':
            mode_arg = '--local';
            environment = { ENVIRONMENT: 'development' };
            break
        case 'remote':
            mode_arg = '';
            environment = { ENVIRONMENT: 'production' };
            break
        default:
            console.error('Invalid mode. Use "local" or "remote".');
            return
    }
    
    const date = args[1] || now.toISOString();

    const cfg = await loadConfig(environment);
    if (!cfg) console.error('Config not found. Set "ENVIRONMENT" environment variable.');

    const ages = new Map(Object.keys(cfg.feeds).map((key) => [key, date]));
    runCommand(`wrangler kv key put --namespace-id '76fc30a6d6d148d5be413382baa29228' age '${JSON.stringify(Object.fromEntries(ages))}' ${mode_arg}`);
})();
const { exec } = require("child_process");

function shellExec(command, { json = false, clientCwd = undefined } = {}) {
	return new Promise((resolve, reject) => {
			exec(`${command} ${json ? "--json" : ""}`, {
				cwd: clientCwd,
				maxBuffer: 5 * 1024 * 1024,
			}, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr));
					return;
				}
				if (stderr && !stderr.startsWith("Debugger")) {
					reject(new Error(stderr));
					return;
				}

				if (json) {

					let json = `[${stdout.slice(0, -1).replace(/\n/g, ",")}]`;
					try {
						resolve(JSON.parse(json));
					} catch (jsonError) {
						reject(jsonError);
					}
				} else {
					resolve(stdout);
				}
			});
		}
	);
}

module.exports = shellExec;

const github = require("@actions/github");
const path = require("path");
const core = require("@actions/core");
const shellExec = require("./helpers/shellExec.js");
const PackageInfo = require("./models/packageInfo.js");
const Git = require("./helpers/git.js");
const { DateTime } = require("luxon");
const marked = require("marked");

const toIgnore = core.getInput("ignore") ? core.getInput("ignore").split(",") : [];

const numberOfCommitsToDisplay = 6;
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const cwd = process.env.GITHUB_WORKSPACE;
const clientWorkingDirectory = core.getInput("directory");
const git = new Git({
	path: cwd,
	clientWorkingDirectory,
	name: "Dependabot with Yarn 3",
	email: "benjamin@vanryseghem.com"
})
const myToken = core.getInput("githubToken") || process.env.GITHUB_TOKEN;
const octokit = github.getOctokit(myToken)

function escapeCommitMessage(commit) {
	let baseUrl = commit.html_url.slice(0, commit.html_url.indexOf("/commit"))
	return commit.commit.message.split("\n")[0]
		.replace(/#(\d+)/, (all, id) => `<a href="${baseUrl}/pull/${id}">${all}</a>`);
}

function displayCommits(commits, diff_url) {
	let result = `${commits.slice(0, numberOfCommitsToDisplay)
		.map((commit) => `<li><a href=${commit.html_url}>${commit.sha.slice(0, 8)}</a> ${escapeCommitMessage(commit)}</li>`)
		.join("\n")}`;

	if (commits.length > numberOfCommitsToDisplay) {
		result += `
<a href="${diff_url}">...</a>`
	}

	return result;
}

function buildMessageFor({ tag, diff }) {
	if (!tag || !diff) {
		return "";
	}

	return `
## ${tag.tag_name}

<details>
<summary>Changelog</summary>
<blockquote>
<h2><a href="${diff.html_url}">${tag.tag_name.replace("v", "")}</a> (${DateTime.fromISO(tag.published_at).toLocaleString(DateTime.DATE_SHORT)})</h2>
${marked(tag.body)}
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
${displayCommits(diff.commits, diff.html_url)}
</ul>
</details>

`;
}

function getMetaDataFor({ owner, repo, version, previousVersion }) {
	return Promise.all([
		octokit.rest.repos.getReleaseByTag({
			owner,
			repo,
			tag: `v${version}`,
		}),
		octokit.rest.repos.compareCommitsWithBasehead({
			owner,
			repo,
			basehead: `v${previousVersion}...v${version}`
		})
	])
		.then(([tag, diff]) => {
			return {
				tag: tag.data,
				diff: diff.data
			};
		})
		.catch((error) => {
			return {}
		});
}

function buildPullRequestMessage(packageInfo) {
	if (!packageInfo.isGit()) {
		return null;
	}
	let { owner, repo } = packageInfo.getRepoInfo();

	if (!owner || !repo) {
		return null;
	}

	let versions = packageInfo.getAllLaterVersions();
	let promises = versions.map((version, index) => getMetaDataFor({
		owner,
		repo,
		previousVersion: index === 0 ? packageInfo.version : versions[index - 1],
		version
	}));

	return Promise.all(promises).then((tags) => {
		return `# ${packageInfo.prName()}

${tags
			.reverse()
			.map(buildMessageFor)
			.join("\n")
			.trim()}
`
	})
}

async function update(packageInfo) {
	let branchName = packageInfo.branchName();
	await git.goToNewBranch(branchName);
	await shellExec(`yarn up "${packageInfo.name}"`, { clientWorkingDirectory });
	await git.addFilesAndCommit(packageInfo.prName());
	await git.pushCommit(branchName, { force: true });

	let message = await buildPullRequestMessage(packageInfo);

	try {

		let pr = await octokit.rest.pulls.create({
			owner,
			repo,
			head: branchName,
			base: "master",
			draft: true,
			title: packageInfo.prName(),
			body: message
		});
		console.log("PR number", pr.data.number);
		return octokit.rest.issues.addLabels({
			owner,
			repo,
			issue_number: pr.data.number,
			labels: ["dependencies"]
		})
	} catch (error) {
		// Silently catch error
		if (error.status && error.status === 422 && error.message && error.message.match("A pull request already exists")) {
			return;
		}
		throw error;
	}
}

async function checkIfUpdateIsNeeded(packageInfo) {
	if (!packageInfo.isUpdateNeeded()) {
		return false;
	}

	return !await checkIfPRExistsFor(packageInfo);
}

function fetchYarnPackages() {
	return shellExec("yarn info --name-only", { json: true, clientWorkingDirectory }).then((data) => {
		let result = {};
		data.forEach((info) => {
			let packageInfo = new PackageInfo(info);
			if (packageInfo.isUpdatable(toIgnore)) {
				result[packageInfo.name] = packageInfo;
			}
		});

		return result;
	});
}

function fetchLatestVersion(names) {
	return shellExec(`yarn npm info ${names.join(" ")}`, { json: true, clientWorkingDirectory });
}

async function checkIfPRExistsFor(packageInfo) {
	return octokit.rest.search.issuesAndPullRequests({
		q: `${packageInfo.prName()} user:${owner} repo:${repo} label:dependencies`
	}).then(({ data: { total_count: count } }) => {
		return count > 0;
	}).catch((error) => {
		console.error(error);
		process.exit(1)
	});
}

fetchYarnPackages()
	.then((packageMap) => {
		return fetchLatestVersion(Object.keys(packageMap)).then((data) => {
			data.forEach((datum) => {
				let packageInfo = packageMap[datum.name];
				packageInfo.setInfo(datum);
			});
			return Object.values(packageMap);
		});
	})
	.then((packages) => {
		return Promise.all(
			packages.map((packageInfo) =>
				checkIfUpdateIsNeeded(packageInfo)
					.then((bool) => bool ? packageInfo : null))
		);
	})
	.then((packages) => packages.filter(each => each))
	.then((packagesToUpdate) => {
		let promise = Promise.resolve();
		packagesToUpdate.forEach((packageInfo) => {
			promise = promise.then(() => {
				console.log("Creating PR:", packageInfo.prName());
				return update(packageInfo)
					.then(() => {
						console.log("PR created");
					})
					.catch((error) => {
						console.error(error);
					});
			});

		});
		return promise;
	})
	.then(() => {
		console.log("DONE");
	})
	.catch((error) => {
		console.error(error);
		process.exit(1)
	});

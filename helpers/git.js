const { Branch, Cred, Reference, Repository, Reset, Signature } = require("nodegit");

class Git {
	constructor({ path, name, email }) {
		this._name = name;
		this._email = email;
		this._repositoryPromise = Repository
			.open(path)
			.catch((error) => {
				console.error(error);
				process.exit(1)
			});

		this._masterCommitPromise = this._repositoryPromise
			.then((repository) => repository.getBranchCommit("master"));
	}

	async goToNewBranch(name) {
		let branch = await this._createBranch(name)
		await this._checkoutBranch(branch);
		return this._reset()
	}

	_createBranch(name) {
		return Promise.all([
			this._repositoryPromise,
			this._masterCommitPromise
		]).then(([repository, masterCommit]) => Branch.create(repository, name, masterCommit, 1))
	}

	_checkoutBranch(branch) {
		return this._repositoryPromise.then((repository) => repository.checkoutBranch(branch))
	}

	_reset() {
		return Promise.all([
			this._repositoryPromise,
			this._masterCommitPromise
		]).then(([repository, masterCommit]) => Reset.reset(repository, masterCommit, Reset.TYPE.HARD));
	}

	async _addYarnFilesToIndex() {
		let repository = await this._repositoryPromise;
		let index = await repository.refreshIndex();
		await index.addAll(["monitor/Monitor.Web.Ui/Client/.yarn/*"]);
		await index.addByPath("monitor/Monitor.Web.Ui/Client/yarn.lock");
		await index.addByPath("monitor/Monitor.Web.Ui/Client/package.json");
		await index.write();
		const changes = await index.writeTree(); // get reference to a set of changes
		const head = await Reference.nameToId(repository, "HEAD"); // get reference to the current state
		return { changes, head };
	}

	async _commitChanges({ changes, head, message }) {
		let repository = await this._repositoryPromise;
		const parent = await repository.getCommit(head); // get the commit for current state
		const author = Signature.now(this._name, this._email); // build auth/committer
		const committer = Signature.now(this._name, this._email);
		return repository.createCommit("HEAD", author, committer, message, changes, [parent]);
	}

	async addFilesAndCommit(message) {
		let { changes, head } = await this._addYarnFilesToIndex();
		return this._commitChanges({ changes, head, message });
	}

	async pushCommit(branchName, { force } = {}) {
		let repository = await this._repositoryPromise;
		let remote = await repository.getRemote("origin");

		await remote.push(
			[
				`${force ? "+" : ""}refs/heads/${branchName}:refs/heads/${branchName}`
			],
			{
				callbacks: {
					credentials: function(url, userName) {
						return Cred.sshKeyFromAgent(userName);
					}
				}
			}
		);
	}
}

module.exports = Git;

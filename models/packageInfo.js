class PackageInfo {
	constructor(string) {
		let segments = string.split("@");
		let name = segments.slice(0, -1).join("@");
		let rest = segments[segments.length - 1];
		let [adapter, version] = rest.split(":");

		this.name = name;
		this.adapter = adapter;
		this.version = version;
	}

	isUpdatable(toIgnore) {
		if (toIgnore.some((each) => this.name.match(each))) {
			return false;
		}

		return this.adapter === "npm";
	}

	setInfo(data) {
		let { version, versions, repository } = data;
		this.repository = repository;
		this.versions = versions;
		this.latestVersion = version; // not sure -> rejects 6.0.0-beta2
	}

	isGit() {
		return !(!this.repository || this.repository.type !== "git");
	}

	getRepoInfo() {
		let { url } = this.repository;
		let prefix = "github.com/";
		let baseIndex = url.indexOf(prefix);
		if (baseIndex < 0) {
			return {};
		}
		let [owner, repo] = url.slice(baseIndex + prefix.length).split("/");
		repo = repo.slice(0, -4);
		return {
			owner,
			repo
		}
	}

	getAllLaterVersions() {
		let startIndex = this.versions.findIndex((version) => version === this.version) + 1;
		return this.versions.slice(startIndex);
	}

	isUpdateNeeded() {
		return this.version !== this.latestVersion;
	}

	prName() {
		return `Bump ${this.name} from ${this.version} to ${this.latestVersion}`;
	}

	branchName() {
		return `dependabot/bump_${this.name}_from_${this.version}_to_${this.latestVersion}`;
	}
}

module.exports = PackageInfo;

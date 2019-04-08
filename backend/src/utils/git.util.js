const fs = require('fs');
const shellExec = require('shell-exec');
const git = require('simple-git/promise');
const gitUtils = {
  async pullRepository(_path, branch = 'master') {
    return await git(_path).pull('origin', branch);
  },
  async createACommit(commit, branch, pluginPath, newBranch) {
    const listFile = await git().diffSummary(['origin/master', 'backend/mobile/plugins/core-plugin']);
    //const listFile = await git().diffSummary([branch, pluginPath]);
    if(listFile.files.length > 0){
      await git().add(['-f', pluginPath]);
      await git().checkoutLocalBranch(newBranch);
      return await git().push(['-u', 'origin', newBranch]);
    }
  },
  /**
   * @method getListPluginInConfig
   * @param {object} plugins
   * @param {string} basePathStore
   * @param {string} plugins[].name
   * @param {string} plugins[].url
   * @param {string} plugins[].branch
   * @param {string} plugins[].package
   */
  async cloneListPlugins(plugins, basePathStore) {
    const pluginsClone = plugins.filter(plugin => {
      return !fs.existsSync(`${basePathStore}/${plugin.name}`)
    });
    await Promise.all(pluginsClone.map(pluginClone => {
      return git().clone(pluginClone.url, `${basePathStore}/${pluginClone.name}`);
    }));
    await Promise.all(pluginsClone
      .filter(plugin => plugin.package)
      .map(plugin => {
        return shellExec(`cd ${basePathStore}/${plugin.name}&& yarn install`);
      })
    );
  },
  async getCurrentBranch() {
    return await git().branchLocal();
  },
  async checkOutBranch(branch) {
    return await git().checkoutBranch(branch);
  }
};
//gitUtils.createACommit('test-branch', 'backend/mobile/plugins/core-plugin', 'push-plugin');

module.exports = gitUtils;
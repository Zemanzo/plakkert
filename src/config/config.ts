import defaultConfig from "./config.json";

/**
 * Way to merge configs goes here
 */

/**
import userConfig from "./config.user.json";

interface Config {
  [key: string]: any;
}
const mergeConfigs = (a: Config, b: Config) => {
	const mergedConfig = a;
	for (let key in a) {
		const altValue = b[key];
		if (altValue) {

		}
	}

	return mergedConfig;
};

const mergedConfig = mergeConfigs(defaultConfig, userConfig);
 */

export default defaultConfig;

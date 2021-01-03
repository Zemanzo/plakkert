import config from "./config/config";

class RestUtil {
  address = config.cloud.enabled && config.cloud.address;

  doRequest(path: string) {
    return fetch("http://" + this.address + path).then((response) => {
      if (response.headers.get("Content-Type")?.includes("application/json")) {
        return response.json();
      } else if (response) {
        return response.text();
      }
    });
  }

  async getAuthenticationMethods() {
    if (!config.cloud.enabled) {
      return [];
    }
    try {
      return await this.doRequest("/authentication");
    } catch (err) {
      return { error: err };
    }
  }
}

export default new RestUtil();

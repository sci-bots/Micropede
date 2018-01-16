/* Launch MicropedeClients asynchronously */
const _ = require('lodash');
const uuidv4 = require('uuid/v4');
const {MicropedeClient, GenerateClientId} = require('./client.js');
const DEFAULT_TIMEOUT = 5000;

class MicropedeAsync extends MicropedeClient {
  constructor(appName, host="localhost", port=1883, version='0.0.0') {
    if (appName == undefined) throw "appName undefined";
    
    const name = `micropede-async-${uuidv4()}`;
    super(appName, host, port, name);
    this.version = version;
    this.listen = _.noop;
  }
  async reset() {
    /* Reset the state of the client (use between actions)*/

    // Generate a new clientId (so that each sub is easier to debug)
    this.clientId = GenerateClientId(this.name, this.appName);
    try {
      // Disconnect and Reconnect the MicropedeClient for this async instance
      await this.disconnectClient();
      await this.connectClient(this.clientId, this.host, this.port);
    } catch (e) {
      throw e;
    }
  }

  setTimeout(timeout) {
    return new Promise((resolve, reject) => {
      setTimeout(()=>{resolve()}, timeout);
    });
  }

  async getState(sender, prop, timeout=DEFAULT_TIMEOUT) {
    /* Get the state of another plugins property */
    const label = `${this.appName}::getState`;
    const topic = `${this.appName}/${sender}/state/${prop}`;
    let done = false;
    try {
      // Fail if this client is awaiting another subscription
      this.enforceSingleSubscription(label, topic);

      // Reset the client
      await this.reset();

      // Subscribe to a state channel of another plugin, and return
      // the first response
      return new Promise((resolve, reject) => {
        this.onStateMsg(sender, prop, (payload, params) => {
          done = true;
          resolve(payload);
        });
        this.setTimeout(timeout).then((d) => {
          if (!done) reject([label, `timeout ${timeout}ms`]);
        });
      });
    } catch (e) {
      throw(this.dumpStack([label, topic], e));
    }
  }

  async getSubscriptions(receiver, timeout=DEFAULT_TIMEOUT) {
    /* Get the subscriptions of another plugin */
    const payload = await this.triggerPlugin(receiver, "get-subscriptions", {}, timeout);
    return payload.response;
  }

  async putPlugin(receiver, property, val, timeout=DEFAULT_TIMEOUT) {
    /* Call put on another plugin */

    // Wrap string payloads into objects (since the put endpoint expects headers)
    if (!_.isPlainObject(val)) {
      let msg = {}; _.set(msg, property, val);
      val = msg;
    }

    // Call a put action on the receiving plugin
    const result = await this.callAction(receiver, property, val, "put",
          timeout);
    return result;
  }

  async triggerPlugin(receiver, action, val={}, timeout=DEFAULT_TIMEOUT) {
    /* Call trigger on another plugin */
    const result = await this.callAction(receiver, action, val,
      "trigger", timeout);
    return result;
  }

  async callAction(receiver, action, val, msgType='trigger', timeout=DEFAULT_TIMEOUT) {
    /* Call action (either trigger or put) and await notification */
    const label = `${this.appName}::callAction::${msgType}`;

    // Remove the timeout if set to -1 (some actions may not notify immediately)
    let noTimeout = false;
    let done = false;
    if (timeout == -1) {
      timeout = DEFAULT_TIMEOUT;
      noTimeout = true;
    }

    // Create a mqtt topic based on type, receiver, and action
    const topic = `microdrop/${msgType}/${receiver}/${action}`;
    // Create the expected notification mqtt endpoint
    const sub = `microdrop/${receiver}/notify/${this.name}`;

    // Setup header
    _.set("__head__.plugin_name", this.name);
    _.set("__head__.version", this.version);

    // Reset the state of the MicropedeAsync client
    try {
      this.enforceSingleSubscription(label, topic);
      await this.reset();
    } catch (e) {
      throw(this.dumpStack([label, topic], e));
    }

    // Await for notifiaton from the receiving plugin
    return new Promise((resolve, reject) => {
      this.onNotifyMsg(receiver, action, (payload, params) => {
        done = true;
        if (payload.status) {
          if (payload.status != 'success') {
            reject(_.flattenDeep([label, _.get(payload, 'response')]));
            return;
          }
        } else {
          console.warn([label, "message did not contain status"]);
        }
        resolve(payload);
      });

      // Cause the notification to fail after given timeout
      this.setTimeout(timeout).then((d) => {
        if (!done) reject([label, `timeout ${timeout}ms`]);
      });
    });

  }

  dumpStack(label, err) {
    /* Dump stack between plugins (technique to join stack of multiple processes') */
    this.disconnectClient();
    if (err.stack)
      return _.flattenDeep([label, JSON.stringify(err.stack).replace(/\\/g, "").replace(/"/g,"").split("\n")]);
    if (!err.stack)
      return _.flattenDeep([label, JSON.stringify(err).replace(/\\/g, "").replace(/"/g,"").split(",")]);
  }

  enforceSingleSubscription(label, topic) {
    /* Ensure that MicropedeAsync instances are only handling one sub at a time */
    if (this.subscriptions.length > 1 ) {
      throw(this.dumpStack([label, topic],
        'only one active sub per async client'));
    }
  }

}

module.exports = MicropedeAsync;

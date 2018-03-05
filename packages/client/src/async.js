/* Launch MicropedeClients asynchronously */
const _ = require('lodash');
const uuidv1 = require('uuid/v1');
const uuidv4 = require('uuid/v4');
const {MicropedeClient, GenerateClientId} = require('./client.js');
const DEFAULT_TIMEOUT = 5000;

const CLIENT_OPTIONS = {resubscribe: false};

class MicropedeAsync {
  constructor(appName, host="localhost", port=undefined, version='0.0.0') {
    if (appName == undefined) throw "appName undefined";
    const name = `micropede-async-${uuidv1()}-${uuidv4()}`;
    try {
      this.client = new MicropedeClient(appName, host, port, name, version, CLIENT_OPTIONS);
      this.client.listen = _.noop;
    } catch (e) {
      console.error(this.dumpStack(this.name, e));
    }
  }
  async reset() {
    /* Reset the state of the client (use between actions)*/

    // Generate a new clientId (so that each sub is easier to debug)
    let {host, port, name, appName} = this.client;
    this.client.clientId = GenerateClientId(name, appName);
    try {
      // Disconnect and Reconnect the MicropedeClient for this async instance
      await this.client.disconnectClient();
      await this.client.connectClient(this.client.clientId, host, port);
    } catch (e) {
      throw e;
    }
  }

  async getState(sender, prop, timeout=DEFAULT_TIMEOUT) {
    /* Get the state of another plugins property */
    const label = `${this.client.appName}::getState`;
    const topic = `${this.client.appName}/${sender}/state/${prop}`;
    let done = false;
    let timer;

    try {
      this.enforceSingleSubscription(label);
      await this.reset();
    } catch (e) {
      throw(this.dumpStack([label, topic], e));
    }

    // Subscribe to a state channel of another plugin, and return
    // the first response
    return new Promise((resolve, reject) => {

      // Success case: (receive message from state channel)
      this.client.onStateMsg(sender, prop, (payload, params) => {
        if (timer) clearTimeout(timer);
        done = true;
        this.client.disconnectClient().then((d) => {
          resolve(payload);
        }).catch((e) => {
          reject(e);
        });
      });

      // Rejection case: (client times out before receiving state msg)
      timer = setTimeout( () => {
        if (!done) {
          done = true;
          this.client.disconnectClient().then((d) => {
            reject([label, topic, `timeout ${timeout}ms`]);
          }).catch((e) => {
            reject([label, topic, `timeout ${timeout}ms`]);
          });
        }
      }, timeout);

    });
  }

  async getSchema(receiver, timeout=DEFAULT_TIMEOUT) {
    /* Get the schema used by the plugin */
    const payload = await this.triggerPlugin(receiver, "get-schema", {}, timeout);
    return payload.response;
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
    const label = `${this.client.appName}::callAction::${msgType}::${action}`;
    let done = false;
    let timer;

    // Remove the timeout if set to -1 (some actions may not notify immediately)
    let noTimeout = (timeout == -1) ? true : false;

    // Setup header
    _.set(val, "__head__.plugin_name", this.client.name);
    _.set(val, "__head__.version", this.client.version);

    // Create a mqtt topic based on type, receiver, and action
    const topic = `${this.client.appName}/${msgType}/${receiver}/${action}`;

    // Reset the state of the MicropedeAsync client
    try {
      this.enforceSingleSubscription(label);
      await this.reset();
    } catch (e) {
      throw(this.dumpStack([label, topic], e));
    }

    // Await for notifiaton from the receiving plugin
    return new Promise((resolve, reject) => {

      this.client.onNotifyMsg(receiver, action, (payload, params) => {
        if (timer) clearTimeout(timer);
        done = true;
        this.client.disconnectClient().then((d) => {
          if (payload.status) {
            if (payload.status != 'success') {
              reject(_.flattenDeep([label, _.get(payload, 'response')]));
              return;
            }
          } else {
            console.warn([label, "message did not contain status"]);
          }
          resolve(payload);
        }).catch((e)=>{
          reject(e)
        });
      });

      this.client.sendMessage(topic, val);

      // Cause the notification to fail after given timeout
      if (!noTimeout) {
        timer = setTimeout( () => {
          if (!done) {
            done = true;
            this.client.disconnectClient().then((d) => {
              reject([label, topic, `timeout ${timeout}ms`]);
            }).catch((e) => {
              reject([label, topic, `timeout ${timeout}ms`]);
            });
          }
        }, timeout);
      }

    });

  }

  dumpStack(label, err) {
    /* Dump stack between plugins (technique to join stack of multiple processes') */
    if (!err) return _.flattenDeep([label, 'unknown error']);
    if (err.stack)
      return _.flattenDeep([label, JSON.stringify(err.stack).replace(/\\/g, "").replace(/"/g,"").split("\n")]);
    if (!err.stack)
      return _.flattenDeep([label, JSON.stringify(err).replace(/\\/g, "").replace(/"/g,"").split(",")]);
  }

  enforceSingleSubscription(label) {
    /* Ensure that MicropedeAsync instances are only handling one sub at a time */
    const totalSubscriptions = this.client.subscriptions.length;
    const defaultSubscriptions = this.client.defaultSubCount;
    if (totalSubscriptions - defaultSubscriptions > 1 ) {
      const msg = 'only one active sub per async client';
      throw(this.dumpStack([label, msg]));
    }
  }

}

module.exports = MicropedeAsync;

/* Base MicropedeClient class */
const Ajv = require('ajv');
const _ = require('lodash');
const backbone = require('backbone');
const isNode = require('detect-node');
const mqtt = require('mqtt');
const uuidv1 = require('uuid/v1');
const uuidv4 = require('uuid/v4');

let RouteRecognizer = require('route-recognizer');
RouteRecognizer = RouteRecognizer.default || RouteRecognizer;

const MqttMessages = require('@micropede/mixins/mqtt-messages.js');
const DEFAULT_TIMEOUT = 5000;

const ajv = new Ajv({useDefaults: true});

let request, request_require;
try {
  // Assume web env (for webpack)
  request = require('browser-request');
} catch (e) {
  // If an error throws, then must be a node env
}
request_require = 'request';

const decamelize = (str, sep='-') => {
  // https://github.com/sindresorhus/decamelize
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1' + sep + '$2')
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1' + sep + '$2')
    .toLowerCase();
}

function ChannelToRoutePath(channel) {
  /* ex. micropede/{plugin}/{attribute} => micropede/:plugin/:attribute */
  return channel.replace(/\{(.+?)\}/g, (x) => {return x.replace(/}/g, "").replace(/{/g, ':')});
}

function ChannelToSubscription(channel) {
  /* ex. micropede/{plugin}/{attribute} => micropede/+/+ */
  return channel.replace(/\{(.+?)\}/g, (x) => '+');
}

function GenerateClientId(name, appName, path='unknown'){
  /* Returns client id , using '>>' as a separator */
  return `${name}>>${path}>>${appName}>>${uuidv1()}-${uuidv4()}`;
}

function WrapData(key, value, name, version) {
  /* Reform messages to objects and add header*/

  let msg = {};
  if (typeof(value) == "object" && value !== null) msg = value;
  else msg[key] = value;

  msg.__head__ = {};
  msg.__head__.plugin_name = name;
  msg.__head__.plugin_version = version;

  return msg;
}

function GetReceiver(payload) {
  return _.get(payload, "__head__.plugin_name");
}

function getClassName(instance) {
  /* ex. DeviceUIPlugin => device-ui-plugin */
  return encodeURI(decamelize(instance.constructor.name));
}

function DumpStack(label, err) {
  if (!err) return _.flattenDeep([label, 'unknown error']);
  if (err.stack)
    return _.flattenDeep([label, err.stack.toString().split("\n")]);
  if (!err.stack)
    return _.flattenDeep([label, err.toString().split(",")]);
}

function TrackClient(client, isPlugin) {
  if (isNode) return;
  if (!window.openClients) window.openClients = [];
  if (!window.openPlugins) window.openPlugins = [];
  if (!isPlugin) window.openClients.push(client)
  if (isPlugin) window.openPlugins.push(client);

  if (window.openClients.length > 150) FlushClients();
}

function FlushClients() {
  if (!window) return;
  const _openClients = _.clone(window.openClients);
  window.openClients = [];

  _.each(_openClients, (c) => {
    try {
      let socket = c.stream.socket;
      socket.onclose = _.noop;
      socket.onerror = () => {console.log("error closing client!")}
      let readyState = socket.readyState;
      switch (readyState) {
        case socket.OPEN:
          c.end(true);
          // socket.close();
          break;
        case socket.CONNECTING:
          c.end(true);
          // socket.close();
          break;
        default:
          break;
      }
    } catch (e) {
      console.error(e);
      // ignore cient already disconnected errors
    }
  });

}

if (!isNode) window.FlushClients = FlushClients;

class MicropedeClient {
  constructor(appName, host="localhost", port, name, version='0.0.0', options, electron) {

    // Dynamically load node request module (default is for webpack env)
    if (isNode) request = require(request_require);

    // Setup client:
    if (appName == undefined) throw "appName undefined";
    if (port == undefined) port = isNode ? 1883 : 8083;
    _.extend(this, backbone.Events);
    _.extend(this, MqttMessages);
    var name = name || getClassName(this);
    const clientId = GenerateClientId(name, appName);
    this.router = new RouteRecognizer();
    this.__listen = _.noop;
    this.appName = appName;
    this.clientId = clientId;
    this.name = name;
    this.subscriptions = [];
    this.schema = {};
    this.host = host;
    this.port = port;
    this.version = version;
    this.options = options ? options : { resubscribe: false};
    this.storageUrl = this.options.storageUrl;
    this.lastMessage = null;

    if (electron !== undefined) {
      const {ipcRenderer} = electron;
      this.ipcRenderer = ipcRenderer;
    }

    this.connectClient(clientId, host, port).then((d) => {
      console.log("Client connected!", this.name, this.clientId);
      this.trigger("connected");
    });
  }

  get isPlugin() { return !_.isEqual(this.listen, _.noop)}

  set listen(f) { this.__listen = f}
  get listen() {return this.__listen }

  addBinding(channel, event, retain=false, qos=0, dup=false) {
    return this.on(event, (d) => this.sendMessage(channel, d, retain, qos, dup));
  }

  sendIpcMessage(message) {
    if (this.ipcRenderer) this.ipcRenderer.send(message);
  }

  validateSchema(name, payload) {
    const validate = ajv.compile(this.schema);
    if (!validate(payload)) throw(validate.errors);
    return payload;
  }

  _getSchema(payload) {
    const LABEL = `${this.appName}::get_schema`;
    return this.notifySender(payload, this.schema, 'get-schema')
  }

  async addSubscription(channel, handler) {
    const path = ChannelToRoutePath(channel);
    const sub = ChannelToSubscription(channel);
    const routeName = `${uuidv1()}-${uuidv4()}`;
    try {
      if (!_.get(this, 'client.connected')) {
        throw `Failed to add subscription.
        Client is not connected (${this.name}, ${channel})`;
      }

      if (this.subscriptions.includes(sub)) {
        await new Promise((resolve, reject) => {
          this.client.unsubscribe(sub, () => {resolve();});
        });
      } else {
        this.subscriptions.push(sub);
        this.router.add([{path, handler}], {add: routeName});
      }

      return new Promise((resolve, reject) => {
        this.client.subscribe(sub, {qos: 0}, (err, granted) => {
          if (err) {reject(err); return}
          resolve(channel);
        });
      });

    } catch (e) {
      return Promise.reject(DumpStack(this.name, e));
    }
  }

  removeSubscription(channel) {
    const path = ChannelToRoutePath(channel);
    const sub = ChannelToSubscription(channel);

    return new Promise((resolve,reject) => {
      this.client.unsubscribe(sub, (err) => {
        if (err) {reject(err); return}
        _.pull(this.subscriptions, sub);
        resolve(true);
      });
    });
  }

  _getSubscriptions(payload, name) {
    const LABEL = `${this.appName}::getSubscriptions`;
    return this.notifySender(payload, this.subscriptions, "get-subscriptions");
  }

  ping(payload, params) {
    const LABEL = `${this.appName}::ping`;
    return this.notifySender(payload, "pong", "ping");
  }

  async loadDefaults(payload, name) {
    /* Load defaults directly to storage (useful for initialization):
      params:
        payload = {
          [storageUrl]: url to broker storage
            (required if storageUrl not passed in options)
          [keys]: list of keys to write to storage
          [__head__]: header information (if sending a response)
        }
    */

    const LABEL = `${this.appName}::loadDefaults`; //console.log(LABEL);
    try {
      let storageUrl = payload.storageUrl || this.storageUrl;
      if (!storageUrl) throw `Missing storageUrl`;

      // Load defaults using ajv's schema validation:
      let defaults = {};
      const validate = ajv.compile(this.schema);
      validate(defaults);

      // if keys passed in payload, then pick which defaults to set using
      // keys array
      if (payload.keys) defaults = _.pick(defaults, payload.keys);

      const baseUrl = `${storageUrl}/write-state`;

      // Write each key val pair to storage url:
      let responses = await Promise.all(_.map(defaults, async (v,k) => {
        v = JSON.stringify(v);
        let options = {
          url: `${baseUrl}?pluginName=${this.name}&key=${k}&val=${v}`,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'X-Request-With'
          }
        };
        return await new Promise((res, rej) => {
          request(options, (e, b, d) => {if (e) {rej(e)} else {res(d)}} );
        });
      }));

      return this.notifySender(payload, responses, 'load-defaults');
    } catch (e) {
      let stack = DumpStack(this.name, e);
      return this.notifySender(payload, stack, 'load-defaults', 'failed');
    }

  }

  exit (payload) {
    if (!isNode) return;
    console.log("Terminating plugin", this.name);
    process.exit();
  }

  notifySender(payload, response, endpoint, status='success') {
    if (status != 'success') {
      console.error(_.flattenDeep([response]));
      response = _.flattenDeep(response);
    }
    const receiver = GetReceiver(payload);
    if (!receiver) {return response}
    this.sendMessage(
      `${this.appName}/${this.name}/notify/${receiver}/${endpoint}`,
      WrapData(null, {status, response}, this.name, this.version)
    );

    return response;
  }

  connectClient(clientId, host, port, timeout=DEFAULT_TIMEOUT) {

    let options  = {clientId: clientId};
    if (!this.isPlugin) options = { clientId: clientId, resubscribe: false, reconnectPeriod: -1, queueQoSZero: false};
    let client = mqtt.connect(`mqtt://${host}:${port}`, options);
    this.off();

    TrackClient(client, this.isPlugin);

    return new Promise(async (resolve, reject) => {
      if (!isNode) {
        client.stream.socket.onerror = (e) => {
          console.log("WEBSOCKET STREAM ERROR");
          FlushClients();
          reject(DumpStack(this.name ,e));
        };
      }

      client.on("error", (e) => {
        reject(DumpStack(this.name ,e));
      });

      client.on("connect", async () => {
        try {
          this.trigger("connected");
          // XXX: Manually setting client.connected state
          client.connected = true;
          this.client = client;
          this.subscriptions = [];
          if (this.isPlugin == true) {
            this.setState("schema", this.schema);
            // Add default subscriptions for plugins:
            await this.onTriggerMsg("load-defaults", this.loadDefaults.bind(this));
            await this.onTriggerMsg("get-subscriptions", this._getSubscriptions.bind(this));
            await this.onTriggerMsg("ping", this.ping.bind(this));

            const topic = `${this.appName}/${this.name}/notify/${this.appName}/connected`;
            this.sendMessage(topic, 'true');

            if (isNode) {
              await this.onTriggerMsg("exit", this.exit.bind(this));
              this.listen();
              this.defaultSubCount = this.subscriptions.length;
              client.on("close", this.exit.bind(this));
              resolve(true);
            } else {
              this.listen();
              this.defaultSubCount = this.subscriptions.length;
              resolve(true);
            }

          } else {
            this.listen();
            this.defaultSubCount = 0;
            resolve(true);
          }
        } catch (e) {
          reject(DumpStack(this.name, e));
        } finally {
          resolve(true);
        }
      });

    client.on("message", this.onMessage.bind(this));

    setTimeout( () => {
      reject(`connect timeout ${timeout}ms`);
      // this.disconnectClient();
    }, timeout);

  });
}

  disconnectClient(timeout=500) {
    let resolved = false;
    return new Promise((resolve, reject) => {
      this.subscriptions = [];
      this.router = new RouteRecognizer();

      if (!_.get(this, "client.connected")) {
        if (resolved == false) {
          this.off();
          resolved = true;
          delete this.client;
          resolve();
        } else {
          return;
        }
      }
      else {
        if (this.client) {

          let end = () => {
            if (resolved == false) {
              this.off();
              resolved = true;
              delete this.client;
              resolve(true);
            } else {
              return;
            }
          }

          this.client.end(true, () => {end();});
          setTimeout( () => {end()}, timeout);

          if (!isNode) {
            let socket = this.client.stream.socket;
            // if (socket.readyState == socket.OPEN) socket.close();
          }

        }
      }

    });
  }

  onMessage(topic, buf){
    if (topic == undefined || topic == null) return;
    if (buf.toString() == undefined) return;
    if (buf.toString().length <= 0) return;
    try {

      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch (e) { msg = buf.toString(); }

      var results = this.router.recognize(topic);
      if (results == undefined) return;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        result.handler(msg, result.params, topic);
      }
    } catch (e) {
      console.error(topic, buf.toString());
      console.error(topic, e);
    }
  }

  async setState(key, value) {
    const topic = `${this.appName}/${this.name}/state/${key}`;
    await this.sendMessage(topic, value, true, 0, false);
  }

  async getState(key, pluginName) {
    if (pluginName == undefined) pluginName = this.name;
    try {
      if (!this.storageUrl) throw `Require storage url to get state directly`;
      let options = {
        url: `${this.storageUrl}/get-state?pluginName=${pluginName}&key=${key}`,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'X-Request-With'
        }
      };
      const data = JSON.parse(await new Promise((res, rej) => {
        request(options, (e, b, d) => {if (e) {rej(e)} else {res(d)}} );
      }));
      if (data.error) throw data.error;
      return data["val"];
    } catch (e) {
      console.error(e, {key, pluginName});
      throw e;
    }
  }

  sendMessage(topic, msg={}, retain=false, qos=0, dup=false){

    if (_.isPlainObject(msg) && msg.__head__ == undefined) {
      msg.__head__ = WrapData(null, null, this.name, this.version).__head__;
    }

    const message = JSON.stringify(msg);
    this.lastMessage = topic;

    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, {retain, qos, dup}, (e) => {
        if (e) reject([this.name, e]);
        resolve();
      });
    });
  }

}
module.exports = MicropedeClient;
module.exports.MicropedeClient = MicropedeClient;
module.exports.GenerateClientId = GenerateClientId;
module.exports.GetReceiver = GetReceiver;
module.exports.DumpStack = DumpStack;
module.exports.WrapData = WrapData;

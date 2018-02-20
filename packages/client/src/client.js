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
    this.schemas = {};
    this.host = host;
    this.port = port;
    this.version = version;
    this.options = options ? options : { resubscribe: false};
    this.lastMessage = null;

    if (electron !== undefined) {
      const {ipcRenderer} = electron;
      this.ipcRenderer = ipcRenderer;
    }

    try {
      this.connectClient(clientId, host, port);
    } catch (e) {
      console.error(e);
    }
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

  addSchema(name, schema) {
    this.schemas[name] = schema;
  }

  validateSchema(name, payload) {
    const validate = ajv.compile(this.schemas[name]);
    if (!validate(payload)) throw(validate.errors);
    return payload;
  }

  _getSchemas(payload) {
    const LABEL = `${this.appName}::get_schemas`;
    return this.notifySender(payload, this.schemas, 'get-schemas')
  }

  async addSubscription(channel, handler) {
    const path = ChannelToRoutePath(channel);
    const sub = ChannelToSubscription(channel);
    const routeName = `${uuidv1()}-${uuidv4()}`;
    try {
      if (!this.client.connected) {
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

    return new Promise((resolve, reject) => {
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

      client.on("connect", () => {
        try {
          // XXX: Manually setting client.connected state
          client.connected = true;
          this.client = client;
          this.subscriptions = [];
          if (this.isPlugin == true) {
            this.onTriggerMsg("get-schema", this._getSchemas.bind(this));
            this.onTriggerMsg("get-subscriptions", this._getSubscriptions.bind(this)).then((d) => {
              if (isNode) {
                this.onTriggerMsg("exit", this.exit.bind(this)).then((d) => {
                  this.listen();
                  this.defaultSubCount = this.subscriptions.length;
                  client.on("close", this.exit.bind(this));
                  resolve(true);
                });
              } else {
                this.listen();
                this.defaultSubCount = this.subscriptions.length;
                resolve(true);
              }

              const topic = `${this.appName}/${this.name}/notify/${this.appName}/connected`
              this.sendMessage(topic, 'true');
            });
          } else {
            this.listen();
            this.defaultSubCount = 0;
            resolve(true);
          }
        } catch (e) {
          reject(DumpStack(this.name, e));
          // this.disconnectClient();
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
    return new Promise((resolve, reject) => {
      this.subscriptions = [];
      this.router = new RouteRecognizer();

      if (!_.get(this, "client.connected")) {
        this.off();
        delete this.client;
        resolve();
      }
      else {
        if (this.client) {

          let end = () => {
            this.off();
            delete this.client;
            resolve(true);
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

module.exports = {MicropedeClient, GenerateClientId, GetReceiver, DumpStack, WrapData};

/* Base MicropedeClient class */

const backbone = require('backbone');
const _ = require('lodash');
const mqtt = require('mqtt');
const uuidv4 = require('uuid/v4');

const RouteRecognizer = require('route-recognizer');
const MqttMessages = require('@micropede/mixins/mqtt-messages.js');

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
  return `${name}>>${path}>>${appName}>>${uuidv4()}`;
}

function getClassName(instance) {
  /* ex. DeviceUIPlugin => device-ui-plugin */
  return encodeURI(decamelize(instance.constructor.name));
}

class MicropedeClient {
  constructor(appName, host="localhost", port=1883, name) {
    _.extend(this, backbone.Events);
    _.extend(this, MqttMessages);
    var name = name || getClassName(this);
    const clientId = GenerateClientId(name, appName);

    this.connectClient(clientId, host, port);
    this.connectClient(clientId, host, port);

    this.router = new RouteRecognizer();
    this.appName = appName;
    this.clientId = clientId;
    this.name = name;
    this.subscriptions = [];
    this.host = host;
    this.port = port;
  }

  addBinding(channel, event, retain=false, qos=0, dup=false) {
    return this.on(event, (d) => this.sendMessage(channel, d, retain, qos, dup));
  }

  addSubscription(channel, handler) {
    const path = ChannelToRoutePath(channel);
    const sub = ChannelToSubscription(channel);
    const routeName = uuidv4();

    if (!this.client.connected) {
      throw `Failed to add subscription.
      Client is not connected (${this.name}, ${channel})`;
    }

    if (this.subscriptions.includes(sub)) {
      throw 'Failed to add subscription. Subscription already exists';
    }

    this.router.add([{path, handler}], {add: routeName});

    return new Promise((resolve, reject) => {
      this.client.subscribe(sub, 0, (err, granted) => {
        if (err) {reject(err); return}
        this.subscriptions.push(sub);
        resolve(granted);
      });
    });
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

  connectClient(clientId, host, port) {
    this.client = mqtt.connect(`mqtt://${host}:${port}`, {clientId});
    return new Promise((resolve, reject) => {
      this.client.on("connect", () => {
        // XXX: Manually setting client.connected state
        this.client.connected = true;
        this.listen();
        resolve(true);
      });
      this.client.on("message", this.onMessage.bind(this));
    });
  }

  disconnectClient() {
    this.subscriptions = [];
    this.router = new RouteRecognizer();
    return new Promise((resolve, reject) => {
      this.client.disconnectClient(true, () => {
        this.off(this.onConnect);
        this.off(this.onMessage);
      });
    });
  }

  onMessage(topic, buf){
    if (topic == undefined || topic == null) return;
    if (buf.toString().length <= 0) return;
    try {

      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch (e) { msg = buf.toString(); }

      var results = this.router.recognize(topic);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        result.handler(msg, result.params);
      }
    } catch (e) {
      console.error(topic, buf.toString());
      console.error(topic, e);
    }
  }

  sendMessage(topic, msg={}, retain=false, qos=0, dup=false){
    const message = JSON.stringify(msg);
    this.client.publish(topic, message, {retain, qos, dup});
  }
}

module.exports = MicropedeClient;

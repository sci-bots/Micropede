const {Console} = require('console');
const path = require('path');

const _ = require('lodash');
const backbone = require('backbone');
const mosca = require('mosca');
const LD = require('localstorage-down');

// const leveljs = require('level-js');
// const jsondown = require('jsondown');

const console = new Console(process.stdout, process.stderr);

let activeClients = 0;

class MicropedeBroker {
  constructor(appName='micropede', clientPort=8083, brokerPort=1883) {
    _.extend(this, backbone.Events);
    this.appName = appName;

    const http  = new Object();
    http.port   = clientPort;
    http.bundle = true;
    http.static = path.resolve('.');

    const settings = new Object();
    settings.port  = brokerPort;
    settings.http  = http;

    const db_settings         = new Object();
    db_settings.path          = appName
    db_settings.subscriptions = 0;
    db_settings.packets       = 0;
    db_settings.db            = LD;

    this.db = new mosca.persistence.LevelUp(db_settings);
    this.db_settings = db_settings;
    this.settings = settings;
    this.server = new mosca.Server(settings);
    this.db.wire(this.server);
  }

  get channel() {return `${this.appName}/broker`;}

  listen() {
    this.server.on('clientConnected', this.clientConnected.bind(this));
    this.server.on('clientDisconnected', this.clientDisconnected.bind(this));
    this.server.on('published', this.topicPublished.bind(this));
    this.server.on('ready', ()=>this.trigger('broker-ready'));
  }

  topicPublished(packet) {
    // console.log("TOPIC PUBLISHED:::");
    // console.log(packet);
  }

  clientConnected(client) {
    activeClients += 1;
    try {
      const [name, path, appName, uid] = client.id.split(">>");
      const topic = `${appName}/${name}/signal/connected`;
      this.sendMessage(topic);
    } catch (e) {
      console.error(e);
    }
  }

  clientDisconnected(client) {
    activeClients -= 1;
    try {
      const [name, path, appName, uid] = client.id.split(">>");
      const topic = `${appName}/${name}/signal/disconnected`;
      this.sendMessage(topic);
    } catch (e) {
      console.error(e);
    }
  }

  sendMessage(topic, msg={}, retain=false, qos=0, dup=false){
    const message = new Object();
    message.topic = topic;
    message.payload = JSON.stringify(msg);
    message.qos = qos;
    message.retain = retain;
    this.server.publish(message);
  }
}

module.exports = MicropedeBroker;

const path = require('path');

const _ = require('lodash');
const backbone = require('backbone');
const mosca = require('mosca');
const leveljs = require('level-js');
// const jsondown = require('jsondown');

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
    // settings.publishNewClient = false;
    // settings.publishClientDisconnect = false;
    // settings.publishSubscriptions = false;

    const db_settings         = new Object();
    db_settings.path          = path.join(".", "db");
    db_settings.subscriptions = 0;
    db_settings.packets       = 0;
    db_settings.db            = leveljs;

    this.db = new mosca.persistence.LevelUp(db_settings);
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
    console.log("TOPIC PUBLISHED:::");
    console.log(packet);
  }

  clientConnected(client) {
    // console.log("CLIENT CONNECTED:::");
    // console.log(client.id);

    const [name, path, app, uid] = client.id.split(">>");
    activeClients += 1;
    // console.log(`active clients: ${activeClients}`);
    if (!name) return;

    // if (!_.includes(name, 'micropede-async') && name != 'undefined'){
    //   console.log('client connected', name);
    // }

    // if (path != undefined){
    //   const sub = `${this.channel}/signal/client-connected`;
    //   this.sendMessage(sub, {name, path});
    // }
  }

  clientDisconnected(client) {
    activeClients -= 1;
    // console.log(`active clients: ${activeClients}`);
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

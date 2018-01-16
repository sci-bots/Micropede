const path = require('path');

const _ = require('lodash');
const backbone = require('backbone');
const mosca = require('mosca');
const leveljs = require('level-js');

class MicropedeBroker {
  constructor(appName='micropede', clientPort=8083, brokerPort=1883) {
    _.extend(this, backbone.Events);
    this.appName = appName;

    const http  = new Object();
    http.port   = 8083;
    http.bundle = true;
    http.static = path.resolve('.');

    const settings = new Object();
    settings.port  = 1883;
    settings.http  = http;

    const db_settings         = new Object();
    db_settings.path          = path.join(__dirname, "db");
    db_settings.subscriptions = 0;
    db_settings.packets       = 0;
    db_settings.db            = leveljs;

    this.db = new mosca.persistence.LevelUp(db_settings);
    this.settings = settings;
    this.server = new mosca.Server(settings);
    this.db.wire(this.server);

    this.listen();
  }

  get channel() {return `${this.appName}/broker`;}

  listen() {
    this.server.on('clientConnected', this.clientConnected.bind(this));
    this.server.on('clientDisconnected', _.noop);
    this.server.on('published', _.noop);
  }

  clientConnected(client) {
    const [name, path, app, uid] = client.id.split(">>");
    if (!name) return;

    if (!_.includes(name, 'micropede-async') && name != 'undefined'){
      console.log('client connected', name);
    }

    if (path != undefined){
      const sub = `${this.channel}/signal/client-connected`;
      this.sendMessage(sub, {name, path});
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

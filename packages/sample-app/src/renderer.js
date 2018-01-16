const yo = require('yo-yo');
const MicropedeClient = require('@micropede/client/src/client.js');
const MicropedeAsync  = require('@micropede/client/src/async.js');
const Broker = require('@micropede/broker/src/index.js');

const broker = new Broker('sample-app');

class MessageLogger extends MicropedeClient {
  constructor(appName='micropede') {
    super(appName);
    this.element = yo`<div></div>`;
    this.messageLog = yo`<ul></ul>`;
    this.element.appendChild(this.messageLog);
  }
  listen() {
    this.onStateMsg("{pluginName}", "{val}", this.logOutput.bind(this));
  }
  logOutput(payload, params) {
    this.messageLog.appendChild(yo`<li>${params.pluginName}, ${params.val}, ${payload}</li>`);
    console.log({payload, params});
  }
}

class MessageGenerator extends MicropedeClient {
  constructor(appName='micropede') {
    super(appName);
    this.element = yo`<div></div>`;
    this.render();
  }
  listen() {
    this.bindStateMsg('blah', 'set-blah')
  }
  inputChanged(e) {
    this.inputValue = e.target.value;
  }
  onSubmit() {
    this.trigger('set-blah', this.inputValue);
  }
  render() {
    this.element.innerHTML = '';
    this.element.appendChild(
      yo`
        <div style='display:inline'>
          <label> Enter something: </label>
          <input onchange=${this.inputChanged.bind(this)}/>
          <button onclick=${this.onSubmit.bind(this)}>Submit</button>
      `
    );
  }
}

const messageLogger = new MessageLogger('sample-app');
const messageGenerator = new MessageGenerator('sample-app');

var container = document.getElementById('message-logger');
container.appendChild(messageLogger.element);
var container = document.getElementById('message-generator');
container.appendChild(messageGenerator.element);

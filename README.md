<p align="center">
  <img alt="micropede" src="https://raw.githubusercontent.com/sci-bots/Micropede/master/docs/images/temp-logo.png">
</p>

Micropede is an Application framework for handling multi-process and/or multi-language plugin architectures. Micropede is built ontop of Mosca js and MQTT js.

Applications include:

- Internet of things
- Harware with multiple user control libraries (such having python and javascript implementations)
- Local web applications (where communication between the browser and the host machine is needed)

Installation:

```bash
  git clone https://github.com/sci-bots/Micropede.git
  npm install --global electron lerna
  npm run boostrap
  # to see a sample run: npm run start
```

Note:

The current implementation of the Micropede Broker requires electron since IndexedDB/level-js is used for storage.
This is to ensure cross-compatibility between different operating systems. If you don't have any intention of attaching a UI to the
broker process, you can set `show: false` when creating the BrowserWindow that is launching @micropede/broker.

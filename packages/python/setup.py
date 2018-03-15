#!/usr/bin/env python

from distutils.core import setup

setup(name='micropede',
      version='0.0.28',
      description='Python client for micropede application framework',
      author='Sci-Bots',
      author_email='lucas@sci-bots.com',
      url='http://sci-bots.com',
      packages=['micropede'],
      install_requires=['paho-mqtt', 'wheezy.routing', 'onoff', 'jsonschema']
)

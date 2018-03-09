import asyncio
import json
import uuid

import pydash as _

from .client import MicropedeClient, generate_client_id, set_timeout

DEFAULT_TIMEOUT = 5000

class MicropedeAsync():
    def __init__(self, app_name, host='localhost', port=None, version='0.0.0', loop=None):
        try:
            if (app_name is None):
                raise(Exception("app_name is None"))
            name = f'micropede-async-{uuid.uuid1()}-{uuid.uuid4()}'
            self.client = MicropedeClient(app_name, host=host, port=port,
                                          name=name, version=version, loop=loop)
            self.safe = self.client.safe
            self.client.listen = _.noop
        except Exception as e:
            raise Exception(self.dump_stack(self.client.name, e))

    async def reset(self):
        host = self.client.host
        port = self.client.port
        name = self.client.name
        app_name = self.client.app_name
        self.client.client_id = generate_client_id(name, app_name)
        await self.client.disconnect_client()
        await self.client.connect_client(self.client.client_id, host, port)
        return

    async def get_state(self, sender, prop, timeout=DEFAULT_TIMEOUT):
        label = f'{self.client.app_name}::get_state'
        topic = f'{self.client.app_name}/{sender}/state/{prop}'
        timer = None
        future = asyncio.Future(loop=self.client.loop)

        try:
            self.enforce_single_subscription(label)
            await self.reset()
        except Exception as e:
            raise Exception(self.dump_stack(self.client.name, e))

        def on_state_msg(payload, params):
            # clear timeout ??
            def on_disconnect(d):
                if (future.done() == False):
                    future.set_result(payload)
            f1 = self.client.disconnect_client()
            f1.add_done_callback(self.safe(on_disconnect))

        self.client.on_state_msg(sender, prop, on_state_msg)
        def on_timeout():
            if future.done():
                return
            def on_disconnect(d):
                future.set_exception(
                    self.dump_stack(label, [topic, f'timeout {timeout}ms']))
            f1 = self.client.disconnect_client()
            f1.add_done_callback(self.safe(on_disconnect))

        set_timeout(self.safe(on_timeout), timeout)

        return await future

    async def get_subscriptions(self, receiver, timeout=DEFAULT_TIMEOUT):
        payload = await self.trigger_plugin(receiver, 'get-subscriptions', {}, timeout)
        return _.get(payload, 'response')

    async def put_plugin(self, receiver, prop, val, timeout=DEFAULT_TIMEOUT):
        if (not _.is_dict(val)):
            msg = {}
            _.set_(msg, prop, val)
            val = msg
        result = await self.call_action(receiver, prop, val,  'put', timeout)
        return result

    async def trigger_plugin(self, receiver, action, val={}, timeout=DEFAULT_TIMEOUT):
        result = await self.call_action(receiver, action, val, 'trigger', timeout)
        return result

    async def call_action(self, receiver, action, val={}, msg_type='trigger',
                             timeout=DEFAULT_TIMEOUT):
        label = f'{self.client.app_name}::callAction::{msg_type}::{action}'
        future = asyncio.Future(loop=self.client.loop)
        # import pdb; pdb.set_trace()

        done = False
        timer = None
        no_timeout = False
        if timeout is -1:
            no_timeout = True

        _.set_(val, '__head__.plugin_name', self.client.name)
        _.set_(val, '__head__.version', self.client.version)
        topic = f'{self.client.app_name}/{msg_type}/{receiver}/{action}'
        try:
            self.enforce_single_subscription(label)
            await self.reset()
        except Exception as e:
            raise self.dump_stack(label, [topic, e])

        def on_notify(payload, params):
            # clear timer??
            def on_disconnect(d):
                if future.done():
                    return

                if (_.get(payload, 'status') is not None):
                    if (_.get(payload, 'status') != 'success'):
                        future.set_exception(
                            self.dump_stack(label, _.get(payload, 'status')))
                else:
                    print("WARNING: ", label, 'message did not contain status')

                if future.done() == False:
                    future.set_result(payload)

            f1 = self.client.disconnect_client()
            f1.add_done_callback(self.safe(on_disconnect))

        self.client.on_notify_msg(receiver, action,
                                  self.safe(on_notify))

        self.client.send_message(topic, val)

        if (no_timeout is not None):
            def on_timeout():
                if future.done():
                    return
                def on_disconnect(d):
                    future.set_exception(
                        self.dump_stack(label, [topic, f'timeout {timeout}ms']))
                f1 = self.client.disconnect_client()
                f1.add_done_callback(self.safe(on_disconnect))
            set_timeout(self.safe(on_timeout), timeout)

        return await future

    def enforce_single_subscription(self, label):
        total_subscriptions = len(self.client.subscriptions)
        if hasattr(self.client, 'default_sub_count'):
            default_subscriptions = self.client.default_sub_count
        else:
            # TODO: This is a temporary fix
            # Should wait for micropede client to set default_sub_count
            default_subscriptions = 2

        if (total_subscriptions - default_subscriptions > 1):
            msg = 'only one active sub per async client'
            raise self.dump_stack(label, msg)

    def dump_stack(self, label, err):
        if (err is None):
            return Exception(_.flatten_deep([label, 'unknown error']))
        if (_.get(err, 'args')):
            return Exception(_.flatten_deep([label, err.args]))
        else:
            return Exception(_.flatten_deep([label, err]))

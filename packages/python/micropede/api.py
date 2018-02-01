from onoff import OnOffMixin


class Topics(OnOffMixin):
    """
       Mixins for listening and subscribing to mqtt messages,
       with helpers to automate common app framework uri structures like:
       state, put, notify, status, trigger, and signal.

       These mixins only automate the naming conventions
       and the expected retain behaviour.
    """

    def on_state_msg(self, sender, val, method):
        return self.add_subscription(f'{self.app_name}/{sender}/state/{val}', method)

    def bind_state_msg(self, val, event, persist=True):
        return self.add_binding(f'{self.app_name}/{self.name}/state/{val}', event, persist)

    def on_put_msg(self, val, method):
        return self.add_subscription(f'{self.app_name}/put/{self.name}/{val}', method)

    def bind_put_msg(self, receiver, val, event):
        return self.add_binding(f'{self.app_name}/put/{receiver}/{val}', event)

    def on_notify_msg(self, sender, topic, method):
        return self.add_subscription(f'{self.app_name}/{sender}/notify/{self.name}/{topic}', method)

    def bind_notify_msg(self, receiver, topic, event):
        return self.add_binding(f'{self.app_name}/{self.name}/notify/{receiver}/{topic}', event)

    def on_status_msg(self, sender, method):
        return self.add_subscription(f'{self.app_name}/status/{sender}', method)

    def bind_status_msg(self, event):
        return self.add_binding(f'{self.app_name}/status/{self.name}', event)

    def on_trigger_msg(self, action, method):
        return self.add_subscription(f'{self.app_name}/trigger/{self.name}/{action}', method)

    def bind_trigger_msg(self, receiver, action, event):
        return self.add_binding(f'{self.app_name}/trigger/{receiver}/{action}', event)

    def on_signal_msg(self, sender, topic, method):
        return self.add_subscription(f'{self.app_name}/{sender}/signal/{topic}', method)

    def bind_signal_msg(self, topic, event):
        return self.add_binding(f'{self.app_name}/{self.name}/signal/{topic}', event)

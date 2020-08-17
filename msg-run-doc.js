// NOTE: validation is not defined here as that would require calling code to
// use seneca-doc

module.exports = {
  get_stats: {
    desc: 'Get event collection statistics.',
    examples: {
      'get:stats': '',
    },
    reply_desc: {
      _start: 'Start time',
      _last: 'Last event time',
      _instance: 'Seneca instance id',
      user_cmd: 'Count of _user_cmd_ (e.g. register, login, ...) events seen',
    },
  },
}

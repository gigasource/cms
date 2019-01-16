'use strict';
const path = require('path');
const unless = require('express-unless');
const cheerio = require('cheerio');
const _ = require('lodash');
require('generator-bind').polyfill();
const JsonFn = require('json-fn');
const autopopulate = require('mongoose-autopopulate');
const traverse = require('traverse');

module.exports = (cms) => {
  const {app, Q} = cms;

  app.get('/cms-types', function* (req, res) {
    res.send(_.map(cms.Types, (v, type) => ({type})));
  })
  app.post('/cms-types/:type/:id/:fn', function* (req, res) {
    const {type, id, fn} = req.params;
    const args = _.map(JsonFn.clone(req.body, true), v => v);
    const {Model, serverFn} = cms.Types[type];
    const obj = yield Model.findById(id).exec();
    const result = obj ? yield* serverFn[fn].bind(obj)(...args) : yield* serverFn[fn](...args);
    res.send(isNaN(result) ? result : result + '');
  })

  app.delete('/cms-types/:type', function* (req, res) {
    const {type} = req.params;
    const {Model} = cms.Types[type];
    Model.remove({});
    const result = yield Model.remove({}).exec();
    res.send(result);
  })

  app.post('/cms-types/:type', function* (req, res) {
    const withTemplate = req.query.template === 'true';
    const noElement = req.query.element === 'false';
    let ref = req.query.element;
    if (ref === 'false') ref = false;
    const content = req.body;
    const {type} = req.params;
    const {Model, Formatter, FormatterUrl, Form, info, fn, serverFnForClient} = cms.Types[type];

    let obj = noElement ? new Model(content) : (ref ? yield Model.findOne({_id: ref}) : yield Model.create(content));

    if (noElement && !ref && Model.session) {
      Model.session(req.session, obj);
      yield obj.save();
    }

    try {
      var _autopopulate = Model.schema.s.hooks._pres.find[0].fn;
      if (_autopopulate) {
        const _query = {
          p: obj,
          populate: function (opt) {
            if (this.p) this.p = this.p.populate(opt);
          }
        }
        _autopopulate.bind(_query)();

        yield _query.p.execPopulate();
      }
    } catch (e) {
    }
    let result = {info, fn, serverFn: serverFnForClient};
    result.data = obj;

    if (withTemplate) {
      result.form = Form;
      const $ = cheerio.load(Formatter ? Formatter : cms.compile(FormatterUrl)(obj));
      cms.filters.element.forEach((fn) => fn($, obj));
      result.template = $.html();
      result.fn = fn;
      result.serverFn = serverFnForClient;
      result.info = info;
    }

    res.send(JsonFn.stringify(result));
  })

  function registerSchema(schema, options) {
    const {
      name, label, formatter, formatterUrl, initSchema, title, fn = {},
      serverFn = {}, tabs, isViewElement = true, mTemplate, admin = {query: []},
      alwaysLoad = false, restifyOptions,
      info = {}, textIndex,
      controller, lean, link, schemaOptions, form
    } = options;
    if (cms.Types[name]) return;

    cms.filters.schema.forEach((fn) => fn(schema, name));
    if (!(schema instanceof cms.mongoose.Schema)) {
      schema = new cms.mongoose.Schema(schema, _.assign({
        toObject: {virtuals: true},
        toJSON: {virtuals: true}
      }, schemaOptions));
    }

    if (options.autopopulate) schema.plugin(autopopulate);


    if (textIndex) {
      schema.add({_textIndex: {type: String, form: false, index: 'text'}});
      schema.pre('findOneAndUpdate', function (next) {
        let _textIndex = ''
        traverse(this._update).forEach(function (node) {
          if (!node) return;
          if (this.key && !_.includes(['$set', '$setOnInsert', '__v', '_id', 'id'], this.key)) {
            const _type = schema.path(this.path.filter(p => p !== '$set' && p !== '$setOnInsert').join('.'));
            if (_type) {
              const type = _type.instance;
              if (type === 'ObjectID') {
                this.block();
                _textIndex += node[cms.Types[_type.options.ref].info.title] + ' ';
              } else if (type === 'Number') {
                _textIndex += node + ' ';
              } else if (type === 'String') {
                _textIndex += node + ' ';
              }
            } else {
              this.block();
            }
          } else if (this.key) {
            this.block();
          }
        })
        this._update._textIndex = _textIndex;
        next();
      });
    }


    // schema.index({'$**': 'text'});

    if (initSchema) initSchema(schema);
    let Model;
    if (name) {
      Model = cms.mongoose.model(name, schema);
      cms.restify.serve(app, Model, _.assign(restifyOptions, {lean: false}));
    }

    _.merge(fn, cms.filters.fn);
    _.merge(serverFn, cms.filters.serverFn);


    cms.Types[name] = {
      schema,
      Model,
      label,
      _form: form,
      clear() {
        this.Form = null;
        this.Paths = null;
        this.Queries = null;
      },
      Formatter: formatter,
      FormatterUrl: formatterUrl,
      info: _.assign({
        title,
        isViewElement,
        admin,
        alwaysLoad
      }, info),
      fn,
      serverFn,
      controller,
      link,
      get serverFnForClient() {
        if (!this._serverFnForClient) {
          this._serverFnForClient = {};
          _.each(serverFn, (fn, k) => {
            this._serverFnForClient[k] = function (post, scope, type, fnName) {
              const model = this;
              if (!scope.serverFnData) scope.serverFnData = [];
              scope.serverFn[fnName] = function () {
                const getFnData = args => _.find(scope.serverFnData,
                  v => JSON.stringify({args: v.args, k: v.k}) === JSON.stringify({args, k: fnName}));
                const data = getFnData(arguments);
                if (data && data.result) {
                  return data.result;
                }
                if (!data) {
                  scope.serverFnData.push({args: arguments, k: fnName});
                  const args = arguments;
                  post(`/cms-types/${type}/${model._id}/${fnName}`, arguments).then(res => getFnData(args).result = res.data)
                  return scope.serverFnData.length - 1;
                }
              };
            }
          })
        }
        return this._serverFnForClient;
      },
      mTemplate,
      lean,
      get webType() {
        if (!this.Form || !this.Paths) {
          _.assign(this, cms.utils.initType(schema, tabs, name));
        }

        return {
          onlySchema: !this.Model,
          template: this.template,
          label: this.label,
          form: this._form || this.Form,
          tabs: tabs,
          queries: this.Queries,
          paths: this.Paths,
          list: [],
          info: this.info,
          fn: this.fn,
          serverFn: this.serverFnForClient,
          columns: _.map(_.pickBy(this.schema.paths, k => ['id', '_id', '__v', '_textIndex'].indexOf(k) === -1, true), (v, k) => {
            return v.options && v.options.label ? v.options.label : k;
          }),
          store: this.store,
          controller: this.controller,
          lean: this.lean,
          link: this.link
        }
      },
      getWebTypeWithData: function* () {
        const Type = this.webType;
        Type.list = yield this.Model.find({});
        return Type;
      },
      get template() {
        if (!this.Formatter && !this.FormatterUrl) return '';
        return this.Formatter ? this.Formatter : cms.readFile(this.FormatterUrl);
      }
    };

    // todo: serverFn
    return Model;
  }

  /*cms.filters.serverFn.link = function*(src) {
   if (!src) return '';
   if (src.indexOf('http://') !== -1) return src;
   return `${cms.data.baseUrlPath}${src[0] === '/' ? '' : '/'}${src}`;
   }*/

  cms.registerSchema = registerSchema;

  // websocket

  const jsonfn = require('./jsonfn');
  cms.io.on(`connection`, function (socket) {

    socket.on('error', function (e) {
      console.warn(e);
    })

    socket.on('getTypes', async function (types, fn) {
      if (types === '*') {
        const Types = {};
        for (const type in cms.Types) {
          Types[type] = cms.Types[type].webType;
          if (Types[type].info.alwaysLoad) {
            Types[type].list.push(...await cms.getModel(type).find({}));
          }
        }
        fn(jsonfn.stringify(Types));
      }
    })

    socket.on('getForm', async function (name, fn) {
      fn(cms.Types[name].webType.form);
    });

    socket.on('registerSchema', async function (schema, options, fn) {
      options = jsonfn.parse(options);
      schema = jsonfn.parse(schema);
      if (cms.Types[options.name]) {
        delete cms.mongoose.connection.models[options.name];
        delete cms.Types[options.name];
      }
      cms.registerSchema(schema, options);
      fn();
    });

    socket.on('interface', async function ({name, chain}, fn) {
      let step = cms.getModel(name);
      if (chain[0].fn === 'new') {
        return fn(new step(...chain[0].args));
      }
      for (const {fn, args} of chain) step = step[fn](...args);
      let result = await step;
      fn(result)
    });

    socket.on('find', async function (type, params = {}, fn) {
      if (Object.keys(cms.Types).indexOf(type) !== -1) {
        let q = cms.getModel(type).find(params.query);
        if (params.populate) q = q.populate(params.populate);
        q = q.sort(params.sort).skip(params.skip).limit(params.limit);
        if (params.lean) q = q.lean();
        fn(await q);
      }
    });

    socket.on('message', function* ({path, params = {}, uuid, model}) {
      const base = '([^\/]*)\/api\/v1\/([^\/]*)';
      const modelQueryTester = new RegExp(`${base}$`);
      const countQueryTester = new RegExp(`${base}\/count$`);
      if (modelQueryTester.test(path)) {
        const [, method, type] = path.match(modelQueryTester);
        if (method === 'get') {
          if (Object.keys(cms.Types).indexOf(type) !== -1) {
            let q = cms.getModel(type).find(params.query);
            if (q.session) q = q.session(socket.handshake.session);
            if (params.populate) {
              q = q.populate(params.populate);
            }
            q = q.sort(params.sort).skip(params.skip).limit(params.limit);
            if (params.lean) q = q.lean();
            const result = yield q;
            socket.emit('message', {result, uuid});
          }
        } else if (method === 'post') {
          if (Object.keys(cms.Types).indexOf(type) !== -1) {
            var Model = cms.Types[type].Model;

            if (!model._id) {
              const _model = new Model();
              model._id = _model._id;
            }

            if (Model.session) Model.session(socket.handshake.session, model);

            try {
              yield Model.findByIdAndUpdate(model._id, _.pickBy(model, (v, k) => k !== '__v', true), {
                upsert: true,
                setDefaultsOnInsert: true
              }).exec();
            } catch (e) {
              console.warn(e);
            }

            let result = yield Model.findById(model._id);
            socket.emit('message', {result, uuid});
          }
        }
      }
      if (countQueryTester.test(path)) {
        const [, method, modelName] = path.match(countQueryTester);
        if (method === 'get') {
          if (Object.keys(cms.Types).indexOf(modelName) !== -1) {
            let q = cms.Types[modelName].Model.find(params.query);
            if (q.session) q = q.session(socket.handshake.session);
            const result = yield q.count(params.query);
            socket.emit('message', {result, uuid});
          }
        }
      }

      var serverFnPath = /\/cms-types\/([^\/]*)\/([^\/]*)\/([^\/]*)/;
      if (serverFnPath.test(path)) {
        const [type, id, fn] = path.match(serverFnPath);
        const args = params;
        const {Model, serverFn} = cms.Types[type];
        const obj = yield Model.findById(id).exec();
        const result = yield* serverFn[fn].bind(obj)(...args);
        socket.emit('message', {result: isNaN(result) ? result : result + '', uuid});
      }
    });
  });
}
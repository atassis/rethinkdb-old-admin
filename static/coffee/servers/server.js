/*
 * decaffeinate suggestions:
 * DS002: Fix invalid constructor
 * DS102: Remove unnecessary code created because of implicit returns
 * DS206: Consider reworking classes to avoid initClass
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Copyright 2010-2015 RethinkDB
// Main server view for the server page

const r = require('rethinkdb');
const h = require("virtual-dom/h");
const patch = require("virtual-dom/patch");
const diff = require("virtual-dom/diff");
const createElement = require("virtual-dom/create-element");

const vdom = require('../vdom_util.coffee');
const models = require('../models.coffee');
const app = require('../app.coffee');
const {
    driver
} = app;
const {
    system_db
} = app;
const vis = require('../vis.coffee');
const log_view = require('../log_view.coffee');
const ui_modals = require('../ui_components/modals.coffee');

const server_profile = require('./profile.coffee');
const server_resp = require('./responsibilities.coffee');


class Model extends Backbone.Model {
    static initClass() {
    
        this.prototype.defaults = {
            name: null,
            id: null
        };
    }
    static query(server_status) {
        return {
            name: server_status('name'),
            id: server_status('id')
        };
    }
}
Model.initClass();

class View extends Backbone.View {
    constructor(...args) {
        this.rename_server = this.rename_server.bind(this);
        this.fetch_server = this.fetch_server.bind(this);
        this.fetch_stats = this.fetch_stats.bind(this);
        this.initialize = this.initialize.bind(this);
        this.render = this.render.bind(this);
        this.remove = this.remove.bind(this);
        super(...args);
    }

    rename_server(event) {
        event.preventDefault();
        if (this.rename_modal != null) {
            this.rename_modal.remove();
        }
        this.rename_modal = new ui_modals.RenameItemModal({
            model: this.model,
            item_type: "server"
        });
        return this.rename_modal.render();
    }

    fetch_server() {
        const query = r.do(
            r.db(system_db).table('server_config').get(this.model.get('id')),
            r.db(system_db).table('server_status').get(this.model.get('id')),
            function(server_config, server_status) {
                const table_config = r.db(system_db).table('table_config');
                const table_status = r.db(system_db).table('table_status');
                return {
                    profile: server_profile.Model.query(server_config, server_status),
                    main: Model.query(server_status),
                    resp: server_resp.Model.query(
                        table_config, table_status, server_config('name'))
                };
        });

        return this.timer = driver.run(query, 5000, (error, result) => {
            if (error != null) {
                this.error = error;
                console.log("Error:", error.message);
            } else {
                this.error = null;
                this.model.set(result.main);
                this.profile_model.set(result.profile);
                this.resp_model.set(result.resp);
            }
            return this.render();
        });
    }

    fetch_stats() {
        return this.stats_timer = driver.run(
            r.db(system_db).table('stats')
                .get(['server', this.model.get('id')])
                .do(stat => ({
                keys_read: stat('query_engine')('read_docs_per_sec'),
                keys_set: stat('query_engine')('written_docs_per_sec')
            })),
            1000, // run every second
            this.stats.on_result // callback
        );
    }

    initialize(id) {
        this.model = new Model({id});
        this.profile_model = new server_profile.Model();
        this.resp_model = new server_resp.Model();
        this.stats = new models.Stats();

        this.timer = null; // set by fetch_server()
        this.error = null; // set by fetch_server (if there's an error)
        this.stats_timer = null; // set by fetch_stats

        this.current_vdom_tree = this.render_vdom();
        this.setElement(createElement(this.current_vdom_tree));
        this.fetch_server();
        return this.fetch_stats();
    }

    render() {
        const new_tree = this.render_vdom();
        patch(this.el, diff(this.current_vdom_tree, new_tree));
        this.current_vdom_tree = new_tree;
        return this;
    }

    remove() {
        driver.stop_timer(this.timer);
        driver.stop_timer(this.stats_timer);
        if (this.rename_modal != null) {
            this.rename_modal.remove();
        }
        return this.cleanup_widgets();
    }

    cleanup_widgets() {
        // This is a bit of a hack. basically the widgets containing
        // other Backbone views won't get their .remove methods called
        // unless patch notices they need to be removed from the
        // DOM. So we patch to an empty DOM before navigating somewhere
        // else. The less stateful views we have, the less this hack
        // will be needed.
        return patch(this.el, diff(this.current_vdom_tree, h("div")));
    }

    render_vdom() {
        if (this.error != null) {
            return render_not_found(this.model.get('id'));
        }
        return h("div#server-view", [
            h("div.operations",
                h("div.dropdown", [
                    h("button.btn.dropdown-toggle",
                        {dataset: {toggle: "dropdown"}},
                        "Operations"),
                    h("ul.dropdown-menu",
                        h("li",
                            h("a.rename", {
                                href: '#',
                                onclick: this.rename_server
                            },
                                "Rename server")
                        )
                    )
                ])),
            h("div.main_title",
                h("h1.title",
                    `Server overview for ${this.model.get('name')}`)
            ),
            h("div.user-alert-space"),
            h("div.section.statistics", [
                h("div.content.row-fluid", [
                    h("div.span4.profile",
                        new vdom.BackboneViewWidget(() => {
                            return new server_profile.View({model: this.profile_model});
                        })
                    ),
                    h("div.span8.performance-graph",
                        new vdom.BackboneViewWidget(() => {
                            return new vis.OpsPlot(
                                this.stats.get_stats, {
                                width:  564,             // width in pixels
                                height: 210,             // height in pixels
                                seconds: 73,             // num seconds to track
                                type: 'server'
                            }
                            );
                        })
                    )
                ])
            ]),
            h("div.section.responsibilities.tree-view2",
                new vdom.BackboneViewWidget(() => {
                    return new server_resp.View({model: this.resp_model});
                })
            ),
            h("div.section.recent-logs", [
                h("h2.title", "Recent log entries"),
                h("div.recent-log-entries",
                    new vdom.BackboneViewWidget(() => {
                        return new log_view.LogsContainer({
                            server_id: this.model.get('id'),
                            limit: 5,
                            query: driver.queries.server_logs
                        });
                    })
                )
            ])
        ]);
    }
}

var render_not_found = server_id => h("div.section", [
    h("h2.title", "Error"),
    h("p", `Server ${server_id} could not be found or is unavailable`),
    h("p", [
        "You can try to ",
        h("a", {href: `#/servers/${server_id}`}, "refresh"),
        " or see a list of all ",
        h("a", {href: "#/servers"}, "servers"),
        "."
    ])
]);

exports.Model = Model;
exports.View = View;

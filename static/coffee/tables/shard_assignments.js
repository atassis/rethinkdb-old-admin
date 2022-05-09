/*
 * decaffeinate suggestions:
 * DS002: Fix invalid constructor
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Copyright 2010-2015 RethinkDB

const models = require('../models.coffee');
const util = require('../util.coffee');
const h = require('virtual-dom/h');
const diff = require('virtual-dom/diff');
const patch = require('virtual-dom/patch');

class ShardAssignmentsView extends Backbone.View {
    constructor(...args) {
        this.initialize = this.initialize.bind(this);
        this.set_assignments = this.set_assignments.bind(this);
        this.render = this.render.bind(this);
        this.remove = this.remove.bind(this);
        super(...args);
    }

    initialize(data) {
        this.listenTo(this.model, 'change', this.render);
        if (data.collection != null) {
            this.collection = data.collection;
        }
        return this.current_vdom_tree = h("div");
    }

    set_assignments(assignments) {
        this.collection = assignments;
        this.listenTo(this.collection, 'change', this.render);
        return this.render();
    }

    render() {
        const new_tree = render_assignments(
            this.model.get('info_unavailable'), this.collection != null ? this.collection.toJSON() : undefined);
        const patches = diff(this.current_vdom_tree, new_tree);
        patch(this.$el.get(0), patches);
        this.current_vdom_tree = new_tree;
        return this;
    }

    remove() {
        return this.stopListening();
    }
}

var render_assignments = (info_unavailable, shard_assignments) => h("div", [
    h("h2.title", "Servers used by this table"),
    render_warning(info_unavailable),
    h("ul.parents", shard_assignments != null ? shard_assignments.map(render_shard) : undefined)
]);

var render_warning = function(info_unavailable) {
    if (info_unavailable) {
        return h("div.unavailable-error", [
            h("p", `Document estimates cannot be updated while not \
enough replicas are available`
            )
        ]);
    }
};

var render_shard = (shard, index) => h("li.parent", [
    h("div.parent-heading", [
        h("span.parent-title", `Shard ${index + 1}`),
        h("span.numkeys", ["~", util.approximate_count(shard.num_keys), " ",
            util.pluralize_noun('document', shard.num_keys)])
    ]),
    h("ul.children", shard.replicas.map(render_replica))
]);

var render_replica = replica => h("li.child", [
    h("span.child-name", [
        replica.state !== 'disconnected' ?
            h("a", {href: `#servers/${replica.id}`}, replica.server)
        :
            replica.server
    ]),
    h(`span.child-role.${util.replica_roleclass(replica)}`,
        util.replica_rolename(replica)),
    h(`span.state.${util.state_color(replica.state)}`,
        util.humanize_state_string(replica.state))
]);

exports.ShardAssignmentsView = ShardAssignmentsView;

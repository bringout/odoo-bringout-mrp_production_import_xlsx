// TODO v19: this module uses the legacy web.FormController.include / _rpc / this.$
// API removed in Odoo 17+. Disabled in __manifest__.py assets; rewrite as an OWL
// patch (@web/views/form/form_controller + @web/core/orm_service) and re-enable.
odoo.define('mrp_production_import.progress', function (require) {
    "use strict";

    const FormController = require('web.FormController');
    const core = require('web.core');
    const _t = core._t;

    FormController.include({
        init: function () {
            this._super.apply(this, arguments);
            this.progressInterval = null;
        },

        willStart: function () {
            const res = this._super.apply(this, arguments);
            if (this.modelName === 'mrp.production.import') {
                this._startProgressTracking();
            }
            return res;
        },

        _startProgressTracking: function () {
            if (this.progressInterval) {
                clearInterval(this.progressInterval);
            }

            const self = this;
            this.progressInterval = setInterval(function () {
                if (self.model.get(self.handle).data.is_processing) {
                    self._checkProgress();
                } else {
                    clearInterval(self.progressInterval);
                }
            }, 1000); // Check every second
        },

        _checkProgress: function () {
            const self = this;
            const recordID = this.model.get(this.handle).res_id;

            if (!recordID) return;

            this._rpc({
                model: 'mrp.production.import',
                method: 'get_import_progress',
                args: [recordID],
            }).then(function (result) {
                if (!result.error && result.is_processing) {
                    // Update progress bar dynamically
                    self.$('.progress-bar').css('width', result.percentage + '%');
                    self.$('.progress-bar span').text(Math.round(result.percentage) + '%');
                    self.$('[name="progress_current"]').text(result.current);

                    if (result.state === 'done') {
                        self.reload();
                    }
                }
            });
        },

        destroy: function () {
            if (this.progressInterval) {
                clearInterval(this.progressInterval);
            }
            this._super.apply(this, arguments);
        },
    });
});
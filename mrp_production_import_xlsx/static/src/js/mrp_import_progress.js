/** @odoo-module **/
// v19 OWL rewrite of the legacy web.FormController.include progress poller.
// Behaviour: on a mrp.production.import form, poll get_import_progress() every
// second while is_processing, update the progress bar, and reload when done.
// ⚠️ Initial port — verify on a real v19 instance (OWL lifecycle hooks + the
// ORM service; the progress-bar DOM update may be better driven by record fields).
import { patch } from "@web/core/utils/patch";
import { FormController } from "@web/views/form/form_controller";
import { useService } from "@web/core/utils/hooks";
import { onMounted, onWillUnmount } from "@odoo/owl";

patch(FormController.prototype, {
    setup() {
        super.setup();
        this._mrpProgressTimer = null;
        if (this.props.resModel === "mrp.production.import") {
            this.orm = useService("orm");
            onMounted(() => this._mrpStartProgress());
            onWillUnmount(() => this._mrpStopProgress());
        }
    },
    _mrpStopProgress() {
        if (this._mrpProgressTimer) {
            clearInterval(this._mrpProgressTimer);
            this._mrpProgressTimer = null;
        }
    },
    _mrpStartProgress() {
        this._mrpStopProgress();
        this._mrpProgressTimer = setInterval(async () => {
            const rec = this.model?.root;
            const resId = rec?.resId;
            if (!resId || !rec?.data?.is_processing) {
                this._mrpStopProgress();
                return;
            }
            const result = await this.orm.call(
                "mrp.production.import", "get_import_progress", [resId]
            );
            if (result && !result.error && result.is_processing) {
                const bar = document.querySelector(".o_form_view .progress-bar");
                if (bar) {
                    bar.style.width = result.percentage + "%";
                    const span = bar.querySelector("span");
                    if (span) span.textContent = Math.round(result.percentage) + "%";
                }
                if (result.state === "done") {
                    this._mrpStopProgress();
                    await rec.load();
                    this.render(true);
                }
            }
        }, 1000);
    },
});

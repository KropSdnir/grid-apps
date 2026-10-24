/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { api } from '../../../app/api.js';

let LANG = api.language.current;
let { FDM } = api.const.MODES,
    { $ } = api.web,
    { uc, ui } = api,
    { bound, toInt, toFloat } = uc,
    { newBlank, newButton, newBoolean, newGroup, newInput, newSelect, newRow } = uc,
    driven = true,
    hideable = true,
    separator = true,
    trigger = true
    ;

function onBooleanClick(el) {
    api.event.emit('click.boolean', el);
}

function onButtonClick(el) {
    api.event.emit('click.button', el);
}

function thinWallSave() {
    let opt = ui.sliceDetectThin;
    let level = opt.options[opt.selectedIndex];
    if (level) {
        api.conf.get().process.sliceDetectThin = level.value;
        api.conf.save();
    }
}

function isMultiHead() {
    let dev = api.conf.get().device;
    return isNotBelt() && dev.extruders && dev.extruders.length > 1;
}

function isMultiExtruder() {
    let dev = api.conf.get().device;
    return dev.extruders && dev.extruders.length > 1;
}

function optSelected(sel) {
    let opt = sel.options[sel.selectedIndex];
    return opt ? opt.value : undefined;
}

function manualSupport() {
    return api.conf.proc().sliceSupportType === 'manual';
}

function hasInfill() {
    return optSelected(ui.sliceFillType) !== 'none'
}

function fillIsLinear() {
    return hasInfill() && optSelected(ui.sliceFillType) === 'linear';
}

function zIntShow() {
    return api.conf.get().controller.devel;
}

function isBelt() {
    return api.device.isBelt();
}

function isNotBelt() {
    return !isBelt();
}

function isTree() {
    return api.conf.proc().sliceSupportTree;
}

function notFwRetract() {
    return !api.conf.get().device.fwRetract;
}

// belt columns support settings are shown only with the columns mode on
function colsOn() {
    return isBelt() && api.conf.proc().sliceSupportColumns;
}

// pillar grid settings only with the pillars style
function pillarsOn() {
    return colsOn() && api.conf.proc().sliceSupportColStyle === 'pillars';
}

// the thin fraction (share of the column height that is the thin top) is edited as the
// base percentage: base % = 100 - top %. shown on the field, stored as the fraction
function baseToFraction() {
    let nv = this.value !== '' ? parseFloat(this.value) : 0;
    if (isNaN(nv)) nv = 0;
    if (this.bound) nv = this.bound(nv);
    this.value = nv;
    return Math.round((100 - nv)) / 100;
}

export function menu() {

    return {

    /** Left Side Menu */

    _____:               newGroup(LANG.sl_menu, $('fdm-layers'), { modes:FDM, driven, hideable, separator, group:"fdm-layers" }),
    sliceHeight:         newInput(LANG.sl_lahi_s, { title:LANG.sl_lahi_l, convert:toFloat }),
    sliceMinHeight:      newInput(LANG.ad_minl_s, { title:LANG.ad_minl_l, convert:toFloat, bound:bound(0,3.0), show:() => ui.sliceAdaptive.checked && isNotBelt() }),
    sliceTopLayers:      newInput(LANG.sl_ltop_s, { title:LANG.sl_ltop_l, convert:toInt }),
    sliceBottomLayers:   newInput(LANG.sl_lbot_s, { title:LANG.sl_lbot_l, convert:toInt }),
    separator:           newBlank({ class:"set-sep", driven }),
    sliceAdaptive:       newBoolean(LANG.ad_adap_s, onBooleanClick, { title: LANG.ad_adap_l, show:isNotBelt }),
    outputLayerRetract:  newBoolean(LANG.ad_lret_s, onBooleanClick, {title:LANG.ad_lret_l}),
    sliceLayerStart:     newSelect(LANG.sl_strt_s, {title:LANG.sl_strt_l}, "start"),
    _____:               newGroup(LANG.sw_menu, $('fdm-walls'), { modes:FDM, driven, hideable, separator, group:"fdm-walls" }),
    sliceShells:         newInput(LANG.sl_shel_s, { title:LANG.sl_shel_l, convert:toFloat }),
    sliceLineWidth:      newInput(LANG.sl_line_s, { title:LANG.sl_line_l, convert:toFloat, bound:bound(0,5) }),
    sliceFillOverlap:    newInput(LANG.fi_over_s, {title:LANG.fi_over_l, convert:toFloat, bound:bound(0.0,1.0)}),
    separator:           newBlank({ class:"set-sep", driven }),
    sliceShellOrder:     newSelect(LANG.sl_ordr_s, { title:LANG.sl_ordr_l}, "shell"),
    sliceDetectThin:     newSelect(LANG.ad_thin_s, { title: LANG.ad_thin_l, action: thinWallSave }, "thin"),
    outputAlternating:   newBoolean(LANG.ad_altr_s, onBooleanClick, {title:LANG.ad_altr_l}),
    sliceZInterleave:    newBoolean(LANG.ad_zint_s, onBooleanClick, {title:LANG.ad_zint_l, show:() => zIntShow() }),
    _____:               newGroup(LANG.fs_menu, $('fdm-solid'), { modes:FDM, driven, hideable, separator, group:"fdm-solid" }),
    sliceFillAngle:      newInput(LANG.fi_angl_s, {title:LANG.fi_angl_l, convert:toFloat}),
    sliceFillGrow:       newInput(LANG.fi_grow_s, {title:LANG.fi_grow_l, convert:toFloat}),
    sliceSolidMinArea:   newInput(LANG.ad_msol_s, {title:LANG.ad_msol_l, convert:toFloat}),
    sliceSolidMinThick:  newInput(LANG.ad_mthk_s, {title:LANG.ad_mthk_l, convert:toFloat}),
    _____:               newGroup(LANG.fi_menu, $('fdm-fill'), { modes:FDM, driven, hideable, separator, group:"fdm-fill" }),
    sliceFillType:       newSelect(LANG.fi_type, {trigger}, "infill"),
    sliceFillSparse:     newInput(LANG.fi_pcnt_s, {title:LANG.fi_pcnt_l, convert:toFloat, bound:bound(0.0,1.0), show:hasInfill}),
    sliceFillRepeat:     newInput(LANG.fi_rept_s, {title:LANG.fi_rept_l, convert:toInt,   bound:bound(1,10),    show:fillIsLinear}),
    _____:               newGroup(LANG.fh_menu, $('fdm-heat'), { modes:FDM, driven, hideable, separator, group:"fdm-heat" }),
    outputTemp:          newInput(LANG.ou_nozl_s, {title:LANG.ou_nozl_l, convert:toInt}),
    outputBedTemp:       newInput(LANG.ou_bedd_s, {title:LANG.ou_bedd_l, convert:toInt}),
    separator:           newBlank({ class:"set-sep", driven }),
    outputDraftShield:   newBoolean(LANG.fr_draf_s, onBooleanClick, {title:LANG.fr_draf_l, trigger, show:() => isNotBelt()}),
    _____:               newGroup(LANG.fc_menu, $('fdm-cool'), { modes:FDM, driven, hideable, separator, group:"fdm-cool" }),
    outputFanLayer:      newInput(LANG.ou_fanl_s, { title:LANG.ou_fanl_l, convert:toInt,   bound:bound(0,255) }),
    outputFanSpeed:      newInput(LANG.ou_fans_s, {title:LANG.ou_fans_l, convert:toInt, bound:bound(0,255)}),
    outputMinLayerTime:  newInput(LANG.ou_layt_s, { title:LANG.ou_layt_l, convert:toInt,   bound:bound(0,200) }),
    _____:               newGroup(LANG.sp_menu, $('fdm-support'), { modes:FDM, driven, hideable, separator, group:"fdm-supp" }),
    sliceSupportType:    newSelect(LANG.sp_type_s, {title:LANG.sp_type_l, trigger}, "support"),
    sliceSupportNozzle:  newSelect(LANG.sp_nozl_s, {title:LANG.sp_nozl_l, show:isMultiHead}, "extruders"),
    separator:           newBlank({ class:"set-sep", driven }),
    sliceSupportAngle:   newInput(LANG.sp_angl_s, {title:LANG.sp_angl_l, convert:toFloat, bound:bound(0.0,90.0)}),
    sliceSupportDensity: newInput(LANG.sp_dens_s, {title:LANG.sp_dens_l, convert:toFloat, bound:bound(0.0,1.0)}),
    sliceSupportSpacing: newInput(LANG.sp_spac_s, {title:LANG.sp_spac_l, convert:toFloat, bound:bound(0.0,20.0)}),
    sliceSupportMinLine: newInput(LANG.sp_minl_s, {title:LANG.sp_minl_l, convert:toFloat, bound:bound(0.0,50.0)}),
    outputSupportMult:   newInput(LANG.sp_flow_s, {title:LANG.sp_flow_l, convert:toFloat, bound:bound(0.0,3.0)}),
    sliceSupportMinWidth:newInput(LANG.sp_minw_s, {title:LANG.sp_minw_l, convert:toFloat, bound:bound(0.0,50.0)}),
    sliceSupportOffset:  newInput(LANG.sp_offs_s, {title:LANG.sp_offs_l, convert:toFloat, bound:bound(0.0,200.0)}),
    sliceSupportExtra:   newInput(LANG.sp_xpnd_s, {title:LANG.sp_xpnd_l, convert:toFloat, bound:bound(0.0,10.0)}),
    sliceSupportVertical:newInput(LANG.sp_vert_s, {title:LANG.sp_vert_l, convert:toInt,   bound:bound(-2,2), show:isBelt}),
    sliceSupportMinArea: newInput(LANG.sp_mina_s, {title:LANG.sp_mina_l, convert:toFloat, bound:bound(0,2000)}),
    sliceSupportMinAreaPct:newInput(LANG.sp_minp_s, {title:LANG.sp_minp_l, convert:toFloat, bound:bound(0,100)}),
    // sliceSupportSpan:    newInput(LANG.sp_span_s, {title:LANG.sp_span_l, convert:toFloat, bound:bound(0.0,200.0), show:() => ui.sliceSupportEnable.checked }),
    separator:           newBlank({ class:"set-sep", driven }),
    sliceSupportOutline: newBoolean(LANG.sp_outl_s, onBooleanClick, {title:LANG.sp_outl_l, xshow: () => !isTree() }),
    sliceSupportGap:     newBoolean(LANG.sp_gaps_s, onBooleanClick, {title:LANG.sp_gaps_l }),
    sliceSupportTree:    newBoolean(LANG.sp_tree_s, onBooleanClick, {title:LANG.sp_tree_l, show:isNotBelt }),
    separator:           newBlank({ class:"set-sep", driven, show:manualSupport }),
    sliceSupportManual: newRow([
        (ui.ssmAdd = newButton(undefined, onButtonClick, {icon:'<i class="fas fa-plus"></i>'})),
        (ui.ssmDel = newButton(undefined, onButtonClick, {icon:'<i class="fas fa-minus"></i>'})),
        (ui.ssmClr = newButton(undefined, onButtonClick, {icon:'<i class="fas fa-trash-alt"></i>'}))
    ], {class:"ext-buttons f-row", show:manualSupport}),
    _____:               newGroup(LANG.spb_menu, $('fdm-supbelt'), { modes:FDM, driven, hideable, separator, group:"fdm-supb", show:isBelt }),
    sliceSupportColumns: newBoolean(LANG.spb_cols_s, onBooleanClick, {title:LANG.spb_cols_l, show:isBelt, trigger}),
    sliceSupportColStyle:newSelect(LANG.spb_styl_s, {title:LANG.spb_styl_l, show:colsOn, trigger}, [ { name:"ribs" }, { name:"pillars" } ]),
    sliceSupportColMode: newSelect(LANG.spb_mode_s, {title:LANG.spb_mode_l, show:colsOn}, [ { name:"percent" }, { name:"mm" }, { name:"count" } ]),
    sliceSupportColSpace:newInput(LANG.spb_spac_s, {title:LANG.spb_spac_l, convert:toFloat, bound:bound(0,500), show:colsOn}),
    sliceSupportColBase: newInput(LANG.spb_base_s, {title:LANG.spb_base_l, convert:toFloat, bound:bound(0,500), show:colsOn}),
    sliceSupportColTop:  newInput(LANG.spb_topw_s, {title:LANG.spb_topw_l, convert:toFloat, bound:bound(0,500), show:colsOn}),
    sliceSupportColShells:newInput(LANG.spb_shel_s, {title:LANG.spb_shel_l, convert:toInt,   bound:bound(1,5), show:colsOn}),
    sliceSupportColFill: newInput(LANG.spb_fill_s, {title:LANG.spb_fill_l, convert:toFloat, bound:bound(0,100), show:colsOn}),
    sliceSupportAnchor:  newInput(LANG.spb_anch_s, {title:LANG.spb_anch_l, convert:toFloat, bound:bound(0,10), show:colsOn}),
    sliceSupportColRim:  newInput(LANG.spb_rim_s, {title:LANG.spb_rim_l, convert:toInt, bound:bound(0,2), show:colsOn}),
    sliceSupportRimStyle:newSelect(LANG.spb_rims_s, {title:LANG.spb_rims_l, show:colsOn}, [ { name:"continuous" }, { name:"perforated" }, { name:"off" } ]),
    sliceSupportColGap:  newInput(LANG.spb_gap_s, {title:LANG.spb_gap_l, convert:toFloat, bound:bound(0,500), show:pillarsOn}),
    sliceSupportPillarLen:newInput(LANG.spb_plen_s, {title:LANG.spb_plen_l, convert:toFloat, bound:bound(0,50), show:pillarsOn}),
    sliceSupportThinFraction:newInput(LANG.spb_rati_s, {title:LANG.spb_rati_l, convert:baseToFraction, bound:bound(0,100), show:isBelt}),
    sliceSupportThinZone:newInput(LANG.sp_tzon_s, {title:LANG.sp_tzon_l, convert:toFloat, bound:bound(0.0,50.0), show:isBelt}),
    separator:           newBlank({ class:"set-sep", driven, show:isBelt }),
    sliceSupportFlush:   newInput(LANG.sp_flsh_s, {title:LANG.sp_flsh_l, convert:toFloat, bound:bound(0,2), show:isBelt}),
    sliceSupportHole:    newInput(LANG.sp_hole_s, {title:LANG.sp_hole_l, convert:toFloat, bound:bound(0,2000), show:isBelt}),
    sliceSupportHoleDepth:newInput(LANG.sp_hdep_s, {title:LANG.sp_hdep_l, convert:toFloat, bound:bound(0,50), show:isBelt}),
    sliceSupportTie:     newInput(LANG.sp_tie_s,  {title:LANG.sp_tie_l,  convert:toInt,   bound:bound(0,200), show:isBelt}),
    sliceSupportRetract: newInput(LANG.sp_retr_s, {title:LANG.sp_retr_l, convert:toFloat, bound:bound(0,50), show:isBelt}),
    beltPedestalBase:    newInput(LANG.sp_base_s, {title:LANG.sp_base_l, convert:toFloat, bound:bound(0,10), show:isBelt}),
    beltPedestalMargin:  newInput(LANG.sp_bmrg_s, {title:LANG.sp_bmrg_l, convert:toFloat, bound:bound(0,20), show:isBelt}),
    separator:           newBlank({ class:"set-sep", driven, show:isBelt }),
    sliceSupportThin:    newInput(LANG.sp_thin_s, {title:LANG.sp_thin_l, convert:toFloat, bound:bound(0.0,20.0), show:isBelt}),
    sliceSupportFinGap:  newInput(LANG.sp_fing_s, {title:LANG.sp_fing_l, convert:toFloat, bound:bound(0.0,50.0), show:isBelt}),
    sliceSupportEdge:    newBoolean(LANG.sp_edge_s, onBooleanClick, {title:LANG.sp_edge_l, show:isBelt}),
    _____:               newGroup(LANG.fl_menu, $('fdm-base'), { modes:FDM, driven, hideable, separator, group:"fdm-base" }),
    firstSliceHeight:    newInput(LANG.fl_lahi_s, {title:LANG.fl_lahi_l, convert:toFloat, show:isNotBelt}),
    firstLayerNozzleTemp:newInput(LANG.fl_nozl_s, {title:LANG.fl_nozl_l, convert:toInt,   show:isNotBelt}),
    firstLayerBedTemp:   newInput(LANG.fl_bedd_s, {title:LANG.fl_bedd_l, convert:toInt,   show:isNotBelt}),
    separator:           newBlank({ class:"set-sep", driven }),
    firstLayerFanSpeed:  newInput(LANG.ou_fans_s, {title:LANG.ou_fans_l, convert:toInt,   bound:bound(0,255), show:isBelt}),
    firstLayerYOffset:   newInput(LANG.fl_zoff_s, {title:LANG.fl_zoff_l, convert:toFloat, show:isBelt}),
    firstLayerFlatten:   newInput(LANG.fl_flat_s, {title:LANG.fl_flat_l, convert:toFloat, show:isBelt}),
    firstLayerBeltFact:  newInput(LANG.fl_mult_s, {title:LANG.fl_mult_l, convert:toFloat, bound:bound(0, 2), show:isBelt}),
    firstLayerRate:      newInput(LANG.fl_rate_s, {title:LANG.fl_rate_l, convert:toFloat}),
    firstLayerFillRate:  newInput(LANG.fl_frat_s, {title:LANG.fl_frat_l, convert:toFloat, show:isNotBelt}),
    separator:           newBlank({ class:"set-sep", driven, show:isBelt }),
    firstLayerBrim:      newInput(LANG.fl_brim_s, {title:LANG.fl_brim_l, convert:toInt,   show:isBelt}),
    firstLayerBrimIn:    newInput(LANG.fl_brin_s, {title:LANG.fl_brin_l, convert:toInt,   show:isBelt}),
    firstLayerBrimTrig:  newInput(LANG.fl_brmn_s, {title:LANG.fl_brmn_l, convert:toInt,   show:isBelt}),
    firstLayerBrimGap:   newInput(LANG.fl_brgp_s, {title:LANG.fl_brgp_l, convert:toFloat, show:isBelt}),
    separator:           newBlank({ class:"set-sep", driven, show:isBelt }),
    firstLayerBeltLead:  newInput(LANG.fl_bled_s, {title:LANG.fl_bled_l, convert:toFloat, show:isBelt}),
    firstLayerBeltBump:  newInput(LANG.fl_blmp_s, {title:LANG.fl_blmp_l, convert:toFloat, bound:bound(0, 10), show:isBelt}),
    beltAnchorFan:       newBoolean(LANG.fl_bafn_s, onBooleanClick, {title:LANG.fl_bafn_l, show:isBelt}),
    beltPrimeLines:      newInput(LANG.fl_bprl_s, {title:LANG.fl_bprl_l, convert:toInt,   bound:bound(0, 10), show:isBelt}),
    beltPrimeWidth:      newInput(LANG.fl_bprw_s, {title:LANG.fl_bprw_l, convert:toFloat, bound:bound(0, 400), show:isBelt}),
    separator:           newBlank({ class:"set-sep", driven, show:isNotBelt }),
    outputBrimCount:     newInput(LANG.fl_skrt_s, {title:LANG.fl_skrt_l, convert:toInt,   show:isNotBelt}),
    outputBrimOffset:    newInput(LANG.fl_skro_s, {title:LANG.fl_skro_l, convert:toFloat, show:isNotBelt}),
    outputRaftSpacing:   newInput(LANG.fr_spac_s, {title:LANG.fr_spac_l, convert:toFloat, bound:bound(0.0,3.0), show:() => ui.outputRaft.checked && isNotBelt() }),
    separator:           newBlank({ class:"set-sep", driven, show:isNotBelt }),
    outputRaft:          newBoolean(LANG.fr_nabl_s, onBooleanClick, {title:LANG.fr_nabl_l, trigger, show:() => isNotBelt()}),
    _____:               newGroup(LANG.ou_menu, $('fdm-output'), { modes:FDM, driven, hideable, separator, group:"fdm-out" }),
    outputFeedrate:      newInput(LANG.ou_feed_s, {title:LANG.ou_feed_l, convert:toInt}),
    outputFinishrate:    newInput(LANG.ou_fini_s, {title:LANG.ou_fini_l, convert:toInt}),
    outputIroningFlow:   newInput(LANG.ou_irfl_s, {title:LANG.ou_irfl_l, convert:toFloat, bound:bound(0,100)}),
    outputIroningSpace:  newInput(LANG.ou_irsp_s, {title:LANG.ou_irsp_l, convert:toFloat, bound:bound(0.05,2)}),
    outputIroningSpeed:  newInput(LANG.ou_irsd_s, {title:LANG.ou_irsd_l, convert:toFloat, bound:bound(1,200)}),
    outputIroningMinArea:newInput(LANG.ou_irma_s, {title:LANG.ou_irma_l, convert:toFloat, bound:bound(0,2000)}),
    outputSeekrate:      newInput(LANG.ou_move_s, {title:LANG.ou_move_l, convert:toInt}),
    separator:           newBlank({ class:"set-sep", driven }),
    outputShellMult:     newInput(LANG.ou_shml_s, {title:LANG.ou_exml_l, convert:toFloat, bound:bound(0.0,2.0)}),
    outputFillMult:      newInput(LANG.ou_flml_s, {title:LANG.ou_exml_l, convert:toFloat, bound:bound(0.0,2.0)}),
    outputSparseMult:    newInput(LANG.ou_spml_s, {title:LANG.ou_exml_l, convert:toFloat, bound:bound(0.0,2.0)}),
    separator:           newBlank({ class:"set-sep", driven }),
    outputRetractDist:   newInput(LANG.ad_rdst_s, {title:LANG.ad_rdst_l, convert:toFloat, show:notFwRetract}),
    outputRetractSpeed:  newInput(LANG.ad_rrat_s, {title:LANG.ad_rrat_l, convert:toInt,   show:notFwRetract}),
    outputRetractWipe:   newInput(LANG.ad_wpln_s, {title:LANG.ad_wpln_l, convert:toFloat, bound:bound(0.0,10)}),
    separator:           newBlank({ class:"set-sep", driven }),
    fdmArcEnabled:       newBoolean(LANG.cx_arce_s, onBooleanClick, { title:LANG.cx_arce_l, show:isNotBelt }),
    fdmArcTolerance:     newInput(LANG.cx_arct_s, {title:LANG.cx_arct_l, convert:toFloat, bound:bound(0,100), trigger, show:() => ui.fdmArcEnabled.checked && isNotBelt()}),
    fdmArcResolution:    newInput(LANG.cx_arcr_s, {title:LANG.cx_arcr_l, convert:toFloat, bound:bound(0,180), trigger, show:() => ui.fdmArcEnabled.checked && isNotBelt()}),
    separator:           newBlank({ class:"set-sep", driven, show:() => ui.fdmArcEnabled.checked && isNotBelt()}),
    outputAvoidGaps:     newBoolean(LANG.ad_agap_s, onBooleanClick, {title:LANG.ad_agap_l}),
    sliceSolidify:       newBoolean(LANG.ad_sold_s, onBooleanClick, {title:LANG.ad_sold_l}),
    _____:               newGroup(LANG.ad_menu, $('fdm-expert'), { modes:FDM, driven, hideable, separator, group:"fdm-xprt" }),
    antiBacklash:        newInput(LANG.ad_abkl_s, {title:LANG.ad_abkl_l, convert:toFloat, bound:bound(0,3)}),
    outputRetractDwell:  newInput(LANG.ad_rdwl_s, {title:LANG.ad_rdwl_l, convert:toInt}),
    outputMinSpeed:      newInput(LANG.ad_mins_s, {title:LANG.ad_mins_l, convert:toFloat, bound:bound(1,200)}),
    outputMaxFlowrate:   newInput(LANG.ad_maxf_s, {title:LANG.ad_maxf_l, convert:toFloat, bound:bound(1,200)}),
    outputPurgeTower:    newInput(LANG.ad_purg_s, {title:LANG.ad_purg_l, convert:toInt,   bound:bound(0,1000), show:isMultiExtruder}),
    outputScarfLength:   newInput(LANG.ad_scar_s, {title:LANG.ad_scar_l, convert:toFloat, bound:bound(0,1000), show:isNotBelt}),
    outputShortPoly:     newInput(LANG.ad_spol_s, {title:LANG.ad_spol_l, convert:toFloat, bound:bound(0,10000)}),
    outputCoastDist:     newInput(LANG.ad_scst_s, {title:LANG.ad_scst_l, convert:toFloat, bound:bound(0.0,10)}),
    sliceCompInner:      newInput(LANG.sl_ofin_s, {title:LANG.sl_ofin_l, convert:toFloat, bound:bound(-10.0,10.0)}),
    sliceCompOuter:      newInput(LANG.sl_ofot_s, {title:LANG.sl_ofot_l, convert:toFloat, bound:bound(-10.0,10.0)}),
    zHopDistance:        newInput(LANG.ad_zhop_s, {title:LANG.ad_zhop_l, convert:toFloat, bound:bound(0,3.0), show:isNotBelt}),
    outputLoops:         newInput(LANG.ag_loop_s, {title:LANG.ag_loop_l, convert:toInt,   bound:bound(-1,1000), show:isBelt}),

    fdmRanges:    $('fdm-ranges'),

    };
}

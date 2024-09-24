/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/
/*
 * Scale 'symlog'.
 *
 * based on https://de.mathworks.com/matlabcentral/fileexchange/57902-symlog
 *
 * Robert (2024). symlog (https://github.com/raaperrotta/symlog), GitHub.
 *
 * SYMLOG applies a modified logarithm scale to the specified or current
 * axes that handles negative values while maintaining continuity across
 * zero. The transformation is defined in an article from the journal
 * Measurement Science and Technology (Webber, 2012):
 *
 * y = sign(x)*(log10(1+abs(x)/(10^C)))
 *
 * where the scaling constant C determines the resolution of the data
 * around zero. The smallest order of magnitude shown on either side of
 * zero will be 10^ceil(C).
 */

import * as zrUtil from 'zrender/src/core/util';
import Scale from './Scale';
import * as numberUtil from '../util/number';
import * as scaleHelper from './helper';

// Use some method of IntervalScale
import IntervalScale from './Interval';
import SeriesData from '../data/SeriesData';
import { DimensionName, ScaleTick } from '../util/types';

const scaleProto = Scale.prototype;
// FIXME:TS refactor: not good to call it directly with `this`?
const intervalScaleProto = IntervalScale.prototype;

const roundingErrorFix = numberUtil.round;
const roundNumber = numberUtil.round;

const mathPow = Math.pow;

import * as symlogUtil from '../util/symlog';

class SymlogScale extends Scale {
    static type = 'symlog';
    readonly type = 'symlog';

    private base: number = 0;      // scale configuration logBase
    private C: number = Infinity;  // scale configuration logC

    private _originalScale: IntervalScale = new IntervalScale();

    private _fixMin: boolean;
    private _fixMax: boolean;

    private _interval: number = 20;
    private _intervalPrecision: number = 2;
    private _niceExtent: [number, number] = [ Infinity, -Infinity ];
    private _niceExtentValue: [number, number] = [ Infinity, -Infinity ];
    private _splitNumber: number = 5;

    // set in unionExtentFromData
    private _origDataExtent: [number, number] = [ Infinity, -Infinity ];
    private _dataPrecision: number = Infinity;
    private _dim: string = 'unknown';

    private debugflag = 0;

    private getSettings() {
       if (this.base === 0.0 && this.C === Infinity) {
           const base = this.getSetting('base');
           const C = this.getSetting('C');
           // ignore 'logBase' if it is not a number
           if (typeof base === 'number' && isFinite(base)) {
              this.base = base;
           }
           else {
              this.base = 10;
           }
           // ignore 'logC' if it is not a number
           if (typeof C === 'number' && isFinite(C)) {
              this.C = C;
           }
           else {
              this.C = Infinity;
           }
           /* eslint-disable */
           if (this.debugflag) {
               console.log("getSettings: base %o, C %o => %o, %o",
                           base, C, this.base, this.C);
           }
           /* eslint-enable */
       }
    }

    private prepareNiceExtent() {
        const extent = this._extent;
        const base = this.base;

        /* eslint-disable */
        if (this.debugflag) {
            console.log("prepareNiceExtent: [ %o, %o ]", extent[0], extent[1]);
        }
        /* eslint-enable */
        let start = this.convertScaleToValue(extent[0]);
        let end = this.convertScaleToValue(extent[1]);
        /* eslint-disable */
        if (this.debugflag) {
            console.log("start/end [ %o, %o ]", start, end);
        }
        /* eslint-enable */
        if (start > 0) {
           start = symlogUtil.prevpow(base, start);
        }
        else if (start < 0) {
           start = symlogUtil.nextpow(base, start);
        }
        end = symlogUtil.nextpow(base, end);
        // Consider this case: start 1e-8 + end 10
        if (start > 0 && start < 1 && end > 1) {
           start = 0;
        }
        // Consider this case: start -1 and end 1e-8
        if (end > 0 && end < 1 && start < -1) {
           end = 1;
        }
        /* eslint-disable */
        if (this.debugflag) {
           console.log("after adjust [ %o, %o ]", start, end);
        }
        this._niceExtentValue = [ start, end ];
        /* eslint-enable */
        start = this.convertValueToScale(start);
        end = this.convertValueToScale(end);
        /* eslint-disable */
        if (this.debugflag) {
           console.log("=> [ %o, %o ]", start, end);
        }
        /* eslint-enable */
        this._niceExtent = [ start, end ];
    }

    convertScaleToValue(scalevalue: number): number {
       return symlogUtil.convertScaleToValue(this.base, scalevalue, this.C);
    }

    convertValueToScale(value: number): number {
       return symlogUtil.convertValueToScale(this.base, value, this.C);
    }

    getScaleTicks(expandToNicedExtent?: boolean): ScaleTick[] {
        const extent = this._extent;
        const interval = this._interval;
        const niceTickExtent = this._niceExtent;
        const dataPrecision = this._dataPrecision;

        /* eslint-disable */
        if (this.debugflag) {
           console.group("%o: getScaleTicks(expandToNicedExtent %o) interval %o",
                         this._dim, expandToNicedExtent, interval);
        }
        /* eslint-enable */

        const ticks = [] as ScaleTick[];
        // If interval is 0, return [];
        if (!interval) {
            /* eslint-disable-next-line */
            console.groupEnd();
            return ticks;
        }

        /* eslint-disable */
        if (this.debugflag) {
           if (expandToNicedExtent) {
               console.log("interval %o (%o) niceExtent [ %o, %o ] (%o, %o)",
                           interval, this.convertScaleToValue(interval),
                           niceTickExtent[0], niceTickExtent[1],
                           this.convertScaleToValue(niceTickExtent[0]),
                           this.convertScaleToValue(niceTickExtent[1]));
           }
           else {
               console.log("interval %o (%o) extent [ %o, %o ] (%o, %o)",
                           interval, this.convertScaleToValue(interval),
                           extent[0], extent[1],
                           this.convertScaleToValue(extent[0]),
                           this.convertScaleToValue(extent[1]));
           }
        }
        /* eslint-enable */

        // Consider this case: using dataZoom toolbox, zoom and zoom.
        const safeLimit = 10000;

        let tick = niceTickExtent[0];
        let start = niceTickExtent[0];
        if (niceTickExtent[0] < extent[0]) {
            if (!expandToNicedExtent) {
                start = extent[0];
            }
            ticks.push({
                value: start
            });
            tick = tick + interval;
        }

        const end = expandToNicedExtent ? niceTickExtent[1] : extent[1];

        while (tick <= end) {
            ticks.push({
                value: tick
            });
            tick = tick + interval;
            const lasttick = ticks[ticks.length - 1].value;
            if (tick === lasttick) {
                // Consider out of safe float point, e.g.,
                // -3711126.9907707 + 2e-10 === -3711126.9907707
                break;
            }
            if (ticks.length > safeLimit) {
                return [];
            }
            let value = this.convertScaleToValue(tick);
            value = roundNumber(value, dataPrecision);
            let lastvalue = this.convertScaleToValue(lasttick);
            lastvalue = roundNumber(lastvalue, dataPrecision);
            if (value > 0 && lastvalue < 0) {
               ticks.push({
                   value: 0,
               });
            }
            if (value === lastvalue) {
               ticks.pop();
            }
            else if (lasttick < start) {
               ticks.pop();
            }
        }
        const lasttick = ticks[ticks.length - 1].value;
        const lastvalue = this.convertScaleToValue(lasttick);
        const endvalue = this.convertScaleToValue(end);
        if (lastvalue < endvalue) {
            ticks.push({
                value: end,
            });
        }
        /* eslint-disable */
        if (this.debugflag) {
           console.log("[ %o, %o ]=> ticks %o",
                       this.convertScaleToValue(start),
                       this.convertScaleToValue(end),
                       ticks);
           console.groupEnd();
        }
        /* eslint-enable */
        return ticks;
    }

    getTicks(expandToNicedExtent?: boolean): ScaleTick[] {
        const extent = this._extent;
        const dataPrecision = this._dataPrecision;
        const base = this.base;
        const C = this.C;

        /* eslint-disable */
        if (this.debugflag) {
           console.group("%o: getTicks(expandToNicedExtent %o)",
                         this._dim, expandToNicedExtent);
        }
        /* eslint-enable */

        const ticks = this.getScaleTicks(expandToNicedExtent);

        // const oldflag = symlogUtil.set_debug(true);
        const valueticks = zrUtil.map(ticks, function (tick) {
            const val = tick.value;
            const value = symlogUtil.convertScaleToValue(base, val, C);
            const powVal = roundNumber(value, dataPrecision);

            return {
                value: powVal
            };
        });
        // symlogUtil.set_debug(oldflag);

        /* eslint-disable */
        if (this.debugflag) {
           // const oldflag = symlogUtil.set_debug(true);
           console.log("[ %o, %o ]=> ticks %o valueticks %o",
                       this.convertScaleToValue(extent[0]),
                       this.convertScaleToValue(extent[1]),
                       ticks, valueticks);
           // symlogUtil.set_debug(oldflag);
           console.groupEnd();
        }
        /* eslint-enable */
        return valueticks;
    }


    setExtent(start: number, end: number): void {

        this.getSettings();

        const origMin = start;
        const origMax = end;

        // called with Infinity, -Infinity to reset scale
        // f.e. from Grid._updateScale
        if (isFinite(start) && isFinite(end)) {
            start = this.convertValueToScale(start);
            end = this.convertValueToScale(end);
        }
        scaleProto.setExtent.call(this, start, end); // scaled

        /* eslint-disable */
        if (this.debugflag) {
            console.log("%o: setExtent(): [ %o, %o ] => [ %o, %o ] ( %o, %o )",
                        this._dim, origMin, origMax, start, end,
                        this.convertScaleToValue(start),
                        this.convertScaleToValue(end));
        }
        /* eslint-enable */
    }

    /**
     * @return {number} end
     */
    getExtent(): [number, number] {
        const dataPrecision = this._dataPrecision;

        if (!isFinite(this._niceExtentValue[0]) || !isFinite(this._niceExtentValue[1])) {
            this.prepareNiceExtent();
        }

        let start = this._niceExtentValue[0];
        let end = this._niceExtentValue[1];

        this._fixMin && (start = roundingErrorFix(start, dataPrecision));
        this._fixMax && (end = roundingErrorFix(end, dataPrecision));

        /* eslint-disable */
        if (this.debugflag) {
            console.log("%o: getExtent() => [ %o, %o ] (%o, %o)",
                        this._dim, start, end,
                        this.convertValueToScale(start),
                        this.convertValueToScale(end));
        }
        /* eslint-enable */

        return [ start, end ];
    }

    unionExtent(extent: [number, number]): void {
        this._originalScale.unionExtent(extent);

        const origMin = extent[0];
        const origMax = extent[1];
        // will only check extent and may revers it
        scaleProto.unionExtent.call(this, extent);

        const start = this.convertValueToScale(extent[0]);
        const end = this.convertValueToScale(extent[1]);

        /* eslint-disable */
        if (this.debugflag) {
            console.log("%o: unionExtent(): [ %o, %o ] => [ %o, %o ]",
                        this._dim, origMin, origMax, start, end);
        }
        /* eslint-enable */
        scaleProto.setExtent.call(this, start, end); // scaled
    }

    unionExtentFromData(data: SeriesData, dim: DimensionName): void {
        // called for every series (f.e. from Grid._updateScale)
        /* eslint-disable */
        if (this.debugflag) {
            console.group("%o: unionExtentFromData(data) data %o", dim, data);
        }
        /* eslint-enable */
        this._dim = dim;
        const maxPrecision = data.getMaxPrecision(dim);
        if (this._dataPrecision === Infinity || this._dataPrecision < maxPrecision) {
           this.C = 1 / mathPow(10, maxPrecision + 1);
           this._dataPrecision = maxPrecision;
           /* eslint-disable */
           if (this.debugflag) {
               console.log("%o: dataPrecision %o, C %o, Base %o",
                           dim, maxPrecision, this.C, this.base);
           }
           /* eslint-enable */
        }

        const extent = data.getApproximateExtent(dim);
        if (extent[0] < this._origDataExtent[0]) {
            this._origDataExtent[0] = extent[0];
        }
        if (extent[1] > this._origDataExtent[1]) {
            this._origDataExtent[1] = extent[1];
        }

        /* eslint-disable */
        if (this.debugflag) {
            console.log("=> [ %o, %o ]",
                        this._origDataExtent[0], this._origDataExtent[1]);
        }
        /* eslint-enable */

        this.unionExtent(this._origDataExtent);
        /* eslint-disable */
        if (this.debugflag) {
            console.groupEnd();
        }
        /* eslint-enable */
    }

    /**
     * Update interval and extent of intervals for nice ticks
     * @param splitNumber default 5 Given approx tick number
     */
    calcNiceTicks(splitNumber?: number, minInterval?: number, maxInterval?: number): void {
        // minInterval and maxInterval only set for 'interval' or 'time
        splitNumber = splitNumber || 5;
        const extent = this._extent;

        /* eslint-disable */
        if (this.debugflag) {
            console.group("%o: calcNiceTicks(splitNumber %o, minInterval %o, maxInterval %o)",
                           this._dim, splitNumber, minInterval, maxInterval);
        }
        /* eslint-enable */
        this.prepareNiceExtent();

        const start = this._niceExtent[0];
        const end = this._niceExtent[1];
        const span = end - start;

        /* eslint-disable */
        if (this.debugflag) {
            console.log("niceExtent [ %o, %o ]", start, end);
            console.log("span %o interval %o", span, span / splitNumber);
        }
        /* eslint-enable */

        if (span === Infinity || span < 0) {
            return;
        }

        const interval = span / splitNumber;

        this._intervalPrecision = numberUtil.getPrecision(interval);
        this._interval = interval;
        this._splitNumber = splitNumber;

        /* eslint-disable */
        if (this.debugflag) {
            console.log("=> interval %o, intervalPrecision %o [ %o, %o ] => [ %o, %o ] ( %o, %o )",
                        interval, this._intervalPrecision,
                        extent[0], extent[1],
                        this._niceExtent[0], this._niceExtent[1],
                        this.convertScaleToValue(this._niceExtent[0]),
                        this.convertScaleToValue(this._niceExtent[1])
                        );
            console.groupEnd();
        }
        /* eslint-enable */
    }

    calcNiceExtent(opt: {
        splitNumber: number, // By default 5.
        fixMin?: boolean,
        fixMax?: boolean,
        minInterval?: number,
        maxInterval?: number
    }): void {

        /* eslint-disable */
        if (this.debugflag) {
            console.group("%o: calcNiceExtent()", this._dim);
        }
        /* eslint-enable */

        // this.calcNiceTicks will change/set
        //   this._intervalPrecision, this._interval, this._niceExtent
	//   and this._niceExtent
        this.calcNiceTicks(opt.splitNumber, opt.minInterval, opt.maxInterval);

        this._fixMin = opt.fixMin;
        this._fixMax = opt.fixMax;
        /* eslint-disable */
        if (this.debugflag) {
            const origExtent = scaleProto.getExtent.call(this); // scaled
            const extent = this._niceExtent;
            console.log("[ %o, %o ] => [ %o, %o ]",
                        origExtent[0], origExtent[1], extent[0], extent[1]);
            console.groupEnd();
        }
        /* eslint-enable */
    }

    parse(val: any): number {
        return val;
    }

    contain(val: number): boolean {
        val = this.convertValueToScale(val);
        return scaleHelper.contain(val, this._extent);
    }

    normalize(val: number): number {
        val = this.convertValueToScale(val);
        return scaleHelper.normalize(val, this._extent);
    }

    scale(val: number): number {
        val = scaleHelper.scale(val, this._extent);
        return this.convertScaleToValue(val);
    }

    getMinorTicks: IntervalScale['getMinorTicks'];
    getLabel: IntervalScale['getLabel'];
}

const proto = SymlogScale.prototype;
proto.getMinorTicks = intervalScaleProto.getMinorTicks;
proto.getLabel = intervalScaleProto.getLabel;

Scale.registerClass(SymlogScale);

export default SymlogScale;

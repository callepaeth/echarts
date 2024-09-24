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
 * helper for Scale 'symlog'.
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

let debugflag: boolean = false;

export function set_debug(flag: boolean): boolean {
    const oldflag = debugflag;
    debugflag = flag;
    return oldflag;
}

function logbase(base: number, value: number): number {
    return Math.log(value) / Math.log(base);
}

export function nextpow(base: number, value: number): number {
    let sign: number = 1;
    let symlog: number;

    if (value === 0.0) {
       return 0;
    }

    if (value < 0.0) {
      sign = -1;
      symlog = logbase(base, -value);
    }
    else {
      symlog = logbase(base, value);
    }
    const result = sign * Math.pow(base, Math.ceil(symlog));
    /* eslint-disable */
    if (debugflag) {
       console.log('nextpow(%o, %o) => %o', base, value, result);
    }
    /* eslint-enable */
    return result;
}

export function prevpow(base: number, value: number): number {
    let sign: number = 1;
    let symlog: number;

    if (value === 0.0) {
       return 0;
    }

    if (value < 0.0) {
      sign = -1;
      symlog = logbase(base, -value);
    }
    else {
      symlog = logbase(base, value);
    }
    const result = sign * Math.pow(base, Math.floor(symlog));
    /* eslint-disable */
    if (debugflag) {
       console.log('prevpow(%o, %o) => %o', base, value, result);
    }
    /* eslint-enable */
    return result;
}

export function convertValueToScale(base: number, value: number, C: number = 0.01): number {
    let sign: number = 1;
    const rC: number = 1 / C;

    // y = sign(x) * log10(1+abs(x)/(10^C))
    if (value < 0.0) {
       sign = -1;
       value = -value;
    }
    value = Math.round(value * rC) / rC;
    // value = roundingErrorFix(value * rC) / rC;
    if (value < C) {
        return 0.0;
    }
    const symlog = sign * (logbase(base, (1 + value / Math.pow(base, C))));
    /* eslint-disable */
    if (debugflag) {
        console.log('convertValueToScale(%o,%o,%o) => %o', base, sign * value, C, symlog);
        const revers = convertScaleToValue(base, symlog, C);
        console.log('---- %o => %o => %o', sign * value, symlog, revers);
    }
    return symlog;
    /* eslint-enable */
}

export function convertScaleToValue(base: number, symlog: number, C: number = 0.01): number {
    let sign: number = 1;

    if (symlog < 0.0) {
        sign = -1;
        symlog = -symlog;
    }

    // y = sign(x) * log10(1+abs(x)/(10^C))
    // x = sign(y) * (10^abs(y) * 10^C - 1);
    const mul1 = Math.pow(base, symlog);  // 10^abs(y)
    const mul2 = Math.pow(base, C); // 10^C
    const rawvalue = sign * (mul1 * mul2 - 1);
    const value = Math.trunc(rawvalue / C) * C;
    /* eslint-disable */
    if (debugflag) {
        console.log('convertScaleToValue(%o,%o,%o) => %o  [trunc((%o * %o * %o - 1) / %o) * %o]',
                    base, sign * symlog, C, value,
                    sign, mul1, mul2, C, C);
    }
    /* eslint-enable */
    return value;
}

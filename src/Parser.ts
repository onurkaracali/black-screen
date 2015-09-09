import Invocation = require("./Invocation");
var ANSIParser: AnsiParserConstructor = require('node-ansiparser');

import e = require('./Enums');
import i = require('./Interfaces');
import Utils = require('./Utils');
import Buffer = require('./Buffer');

import Color = e.Color;
import Weight = e.Weight;

var CGR: { [indexer: string]: i.Attributes|string } = {
    0: {color: Color.White, weight: e.Weight.Normal, underline: false, 'background-color': Color.Black},
    1: {weight: Weight.Bold},
    2: {weight: Weight.Faint},
    4: {underline: true},
    7: 'negative',
    30: {color: Color.Black},
    31: {color: Color.Red},
    32: {color: Color.Green},
    33: {color: Color.Yellow},
    34: {color: Color.Blue},
    35: {color: Color.Magenta},
    36: {color: Color.Cyan},
    37: {color: Color.White},
    38: 'color',
    40: {'background-color': Color.Black},
    41: {'background-color': Color.Red},
    42: {'background-color': Color.Green},
    43: {'background-color': Color.Yellow},
    44: {'background-color': Color.Blue},
    45: {'background-color': Color.Magenta},
    46: {'background-color': Color.Cyan},
    47: {'background-color': Color.White},
    48: 'background-color'
};

function isSetColorExtended(cgrValue: any) {
    return cgrValue == 'color' || cgrValue == 'background-color';
}

var CSI = {
    flag: {
        CUP: 'H',
        CUU: 'A',
        CUD: 'B',
        CUF: 'C',
        CUB: 'D',
        HVP: 'f',
        eraseDisplay: 'J',
        eraseInLine: 'K',
        selectGraphicRendition: 'm'
    },
    erase: {
        toEnd: 0,
        toBeginning: 1,
        entire: 2,
    }
};

var DECPrivateMode = '?';

class Parser {
    private parser: AnsiParser;
    private buffer: Buffer;

    constructor(private invocation: Invocation) {
        this.buffer = this.invocation.getBuffer();
        this.parser = this.initializeAnsiParser();
    }

    parse(data: string): void {
        this.parser.parse(data);
    }

    private initializeAnsiParser(): AnsiParser {
        return new ANSIParser({
            inst_p: (text: string) => {
                Utils.log('text', text);

                for (var i = 0; i != text.length; ++i) {
                    this.buffer.write(text.charAt(i));
                }
            },
            inst_o: function (s: any) {
                Utils.error('osc', s);
            },
            inst_x: (flag: string) => {
                Utils.log('flag', flag);
                this.buffer.write(flag);
            },
            /**
             * CSI handler.
             */
            inst_c: (collected: any, params: Array<number>, flag: string) => {
                Utils.log('csi', collected, params, flag);

                if (collected == '?') {
                    if (params.length != 1) {
                        return Utils.error(`CSI private mode has ${params.length} parameters: ${params}`);
                    }
                    if (flag != 'h' && flag != 'l') {
                        return Utils.error(`CSI private mode has an incorrect flag: ${flag}`);
                    }
                    var mode = params[0];
                    var handlerResult = this.decPrivateModeHandler(mode, flag);

                    if (handlerResult.status == 'handled') {
                        Utils.log(`%cCSI ? ${mode} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                    } else {
                        Utils.error(`%cCSI ? ${mode} ${flag}`, "color: blue", handlerResult.description, handlerResult.url);
                    }

                    return
                }

                switch (flag) {
                    case CSI.flag.selectGraphicRendition:
                        if (params.length == 0) {
                            this.buffer.setAttributes(CGR[0]);
                            return;
                        }

                        while (params.length) {
                            var cgr = params.shift();

                            var attributeToSet = CGR[cgr];

                            if (!attributeToSet) {
                                Utils.error('cgr', cgr, params);
                            } else if (isSetColorExtended(attributeToSet)) {
                                var next = params.shift();
                                if (next == 5) {
                                    var colorIndex = params.shift();
                                    this.buffer.setAttributes({[<string>attributeToSet]: e.ColorIndex[colorIndex]});
                                } else {
                                    Utils.error('cgr', cgr, next, params);
                                }
                            } else if (attributeToSet == 'negative'){
                                var attributes = this.buffer.getAttributes();

                                this.buffer.setAttributes({
                                    'background-color': attributes.color,
                                    'color': attributes['background-color']
                                });
                            } else {
                                this.buffer.setAttributes(attributeToSet);
                            }
                        }
                        break;
                    case CSI.flag.CUU:
                        this.buffer.moveCursorRelative({vertical: -(params[1] || 1)});
                        break;
                    case CSI.flag.CUD:
                        this.buffer.moveCursorRelative({vertical: (params[1] || 1)});
                        break;
                    case CSI.flag.CUF:
                        this.buffer.moveCursorRelative({horizontal: (params[1] || 1)});
                        break;
                    case CSI.flag.CUB:
                        this.buffer.moveCursorRelative({horizontal: -(params[1] || 1)});
                        break;
                    case CSI.flag.CUP:
                    case CSI.flag.HVP:
                        this.buffer.moveCursorAbsolute({vertical: params[0] || 1, horizontal: params[1] || 1});
                        break;
                    case CSI.flag.eraseDisplay:
                        switch (params[0]) {
                            case CSI.erase.entire:
                                this.buffer.clear();
                                break;
                            case CSI.erase.toEnd:
                            case undefined:
                                this.buffer.clearToEnd();
                                break;
                            case CSI.erase.toBeginning:
                                this.buffer.clearToBeginning();
                                break;
                        }
                        break;

                    case 'c':
                        this.invocation.write('\x1b>1;2;');
                        break;
                    case CSI.flag.eraseInLine:
                        switch (params[0]) {
                            case CSI.erase.entire:
                                this.buffer.clearRow();
                                break;
                            case CSI.erase.toEnd:
                            case undefined:
                                this.buffer.clearRowToEnd();
                                break;
                            case CSI.erase.toBeginning:
                                this.buffer.clearRowToBeginning();
                                break;
                        }
                        break;
                    default:
                        Utils.error('csi', collected, params, flag);
                }
            },
            inst_e: (collected: any, flag: string) => {
                switch (flag) {
                    case 'A':
                        this.buffer.moveCursorRelative({vertical: -1});
                        break;
                    case 'B':
                        this.buffer.moveCursorRelative({vertical: 1});
                        break;
                    case 'C':
                        this.buffer.moveCursorRelative({horizontal: 1});
                        break;
                    case 'D':
                        this.buffer.moveCursorRelative({horizontal: -1});
                        break;
                    default:
                        Utils.error('esc', collected, flag);
                }
            }
        });
    }

    private decPrivateModeHandler(ps: number, flag: string) {
        var description = '';
        var url = '';
        var status = 'handled';
        var isSet = flag == 'h';

        //noinspection FallThroughInSwitchStatementJS
        switch (ps) {
            case 3:
                url = "http://www.vt100.net/docs/vt510-rm/DECCOLM";

                if (!isSet) {
                    description = "80 Column Mode (DECCOLM)";

                    this.invocation.setDimensions({columns: 80, rows: this.invocation.getDimensions().rows});
                    break;
                }
            case 12:
                if (isSet) {
                    description = "Start Blinking Cursor (att610).";

                    this.buffer.blinkCursor(true);
                } else {
                    description = "Stop Blinking Cursor (att610).";

                    this.buffer.blinkCursor(false);
                }

                break;
            case 25:
                url = "http://www.vt100.net/docs/vt510-rm/DECTCEM";

                if (isSet) {
                    description = "Show Cursor (DECTCEM).";

                    this.buffer.showCursor(true);
                } else {
                    description = "Hide Cursor (DECTCEM).";

                    this.buffer.showCursor(false);
                }
                break;
            case 1049:
                if (isSet) {
                    description = "Save cursor as in DECSC and use Alternate Screen Buffer, clearing it first.  (This may be disabled by the titeInhibit resource).  This combines the effects of the 1047  and 1048  modes.  Use this with terminfo-based applications rather than the 47  mode.";

                    this.buffer.activeBuffer = 'alternate';
                    // TODO: Add Implementation
                    break;
                }
            case 2004:
                if (isSet) {
                    description = "Set bracketed paste mode.";
                    // TODO: Add Implementation
                    break;
                }
            default:
                status = 'unhandled';
        }

        return {
            status: status,
            description: description,
            url: url
        };
    }
}

export = Parser;

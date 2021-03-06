import * as fs from 'fs';
import * as _ from 'lodash';
import * as i from './Interfaces';
import * as events from 'events';
import Invocation from './Invocation';
import Aliases from './Aliases';
import History from './History';
import Utils from './Utils';
import Serializer from "./Serializer";
var remote = require('remote');
var app = remote.require('app');

export default class Terminal extends events.EventEmitter {
    invocations: Array<Invocation> = [];
    currentDirectory: string;
    history: History;
    gitBranchWatcher: fs.FSWatcher;

    private stateFileName = `${Utils.homeDirectory}/.black-screen-state`;

    // The value of the dictionary is the default value used if there is no serialized data.
    private serializableProperties: _.Dictionary<any> = {
        currentDirectory: `String:${Utils.homeDirectory}`,
        history: `History:[]`
    };

    constructor(private dimensions: i.Dimensions) {
        super();

        // TODO: We want to deserialize properties only for the first instance
        // TODO: of Terminal for the application.
        this.deserialize();
        this.history = new History();

        this.on('invocation', this.serialize.bind(this));

        this.clearInvocations();
    }

    createInvocation(): void {
        var invocation = new Invocation(this.currentDirectory, this.dimensions, this.history);

        invocation
            .once('clear', _ => this.clearInvocations())
            .once('end', _ => {
                if (app.dock) {
                    app.dock.bounce('informational');
                }
                this.createInvocation();
            })
            .once('working-directory-changed', (newWorkingDirectory: string) => this.setCurrentDirectory(newWorkingDirectory));

        this.invocations = this.invocations.concat(invocation);
        this.emit('invocation');
    }

    setDimensions(dimensions: i.Dimensions): void {
        this.dimensions = dimensions;

        this.invocations.forEach(invocation => invocation.setDimensions(dimensions));
    }

    clearInvocations(): void {
        this.invocations = [];
        this.createInvocation();
    }

    setCurrentDirectory(value: string): void {
        remote.getCurrentWindow().setRepresentedFilename(value);
        this.currentDirectory = Utils.normalizeDir(value);
        app.addRecentDocument(value);
        this.watchGitBranch(value);
    }

    private watchGitBranch(directory: string): void {
        if (this.gitBranchWatcher) {
            this.gitBranchWatcher.close();
        }
        var gitDirectory = `${directory}/.git`;

        Utils.ifExists(gitDirectory, () => {
            this.setGitBranch(gitDirectory);
            this.gitBranchWatcher = fs.watch(gitDirectory, (type, fileName) => {
                if (fileName === 'HEAD') {
                    this.setGitBranch(gitDirectory);
                }
            })
        }, () => this.emit('vcs-data', {isRepository: false}));
    }

    private setGitBranch(gitDirectory: string) {
        fs.readFile(`${gitDirectory}/HEAD`, (error, buffer) => {
            var data: i.VcsData = {
                isRepository: true,
                branch: /ref: refs\/heads\/(.*)/.exec(buffer.toString())[1],
                // TODO: Set proper status.
                status: 'clean'
            };
            this.emit('vcs-data', data);
        });
    }

    private serialize(): void {
        var values: _.Dictionary<string> = {};

        _.each(this.serializableProperties, (value: string, key: string) =>
            values[key] = Serializer.serialize((<any>this)[key])
        );

        fs.writeFile(this.stateFileName, JSON.stringify(values), (error: any) => {
            if (error) debugger;
        })
    }

    private deserialize(): void {
        try {
            var state = JSON.parse(fs.readFileSync(this.stateFileName).toString());
        } catch (error) {
            state = this.serializableProperties;
        }

        _.each(state, (value: string, key: string) => {
            var setterName = `set${_.capitalize(key)}`;
            var that = (<any>this);
            var deserializedValue = Serializer.deserialize(value);

            if (that[setterName]) {
                that[setterName](deserializedValue);
            } else {
                that[key] = deserializedValue;
            }
        });
    }
}

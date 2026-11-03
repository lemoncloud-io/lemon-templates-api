const ts = require('typescript');

// A deliberately small fixture-only loader, not the service's type-checking build.
// Returning the TS map in callback argument 3 lets webpack compose JS -> TS.
module.exports = function fixtureTypeScriptLoader(source) {
    const result = ts.transpileModule(source, {
        fileName: 'fixture/handler.ts',
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            sourceMap: true,
            inlineSources: true,
        },
        reportDiagnostics: true,
    });
    const errors = result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) return this.callback(new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => '.', getCanonicalFileName: name => name, getNewLine: () => '\n',
    })));
    const map = JSON.parse(result.sourceMapText);
    map.sources = [this.resourcePath];
    this.callback(null, result.outputText.replace(/^\/\/# sourceMappingURL=.*$/gm, ''), map);
};

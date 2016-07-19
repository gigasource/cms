controller.$inject = ['$scope', 'cms'];

function controller($scope, cms) {
    let {path, model, fields} = $scope.formState;
    path = _.dropRight(path.split('\.')).join('.');

    const Type = cms.data.types[_.get(model,path).BindType];
    $scope.to.options = _.map(Type.columns, v => ({name: v, value: v}));
}


export default controller;
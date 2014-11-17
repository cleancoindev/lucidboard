(function() {
  angular.module('hansei.ui')
    .directive('card', [function() {
      return {
        restrict: 'E',
        templateUrl: '/templates/_card.html',
        scope: {
          board:        '=',
          card:         '=',
          column:       '=',
          index:        '=',
          cardDragging: '='
        },
        controller: ['$scope', 'api', function($scope, api) {
          var board = $scope.board;

          $scope.dropSuccessHandler = function($event) {
            // console.log('array', $scope.index, $scope.column.cards);
            // array.splice(index, 1);
          };

          $scope.moveToJunction = function($event, $data, array, destColumnId, position) {
            // console.log('moveToJunction', arguments);
            // console.log('moveToJunctionData', $data);
            // array.push($data);
            api.boardMoveCard(board.id(), {
              cardId:       $data.id,
              destColumnId: destColumnId,
              destPosition: position
            });
          };

          $scope.combineCards = function($event, $data, destCardId) {
            return;
            console.log('ok', arguments);
            var target = $event.target;
            // if (!confirm('Are you sure you want to combine these cards?')) return;
            console.log('um', destCardId);
            console.log('target',$event.target);
          };

          // This directive is used without a card to create a junction where cards can
          // be dropped. The rest of this function is not needed in this case.
          if (!$scope.card) return;

          $scope.checkCardContent = function(content, columnId, id) {
            api.cardUpdate(board.id(), columnId, {id: id, content: content});
            // the false returned will close the editor and not update the model.
            // (model update will happen when the event is pushed from the server)
            return false;
          };

          $scope.upvote = function(card, event) {
            event.stopPropagation();
            event.preventDefault();
            api.cardUpvote(board.id(), board.column(card.column).id, card.id);
          };

          $scope.$watch('cardDragging', function(a) {
            // console.log('YAYY', a);
          });
        }],
      };
    }])
})();

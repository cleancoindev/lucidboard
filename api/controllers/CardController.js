var async = require('async'),
    util  = require('../services/util'),
    redis = require('../services/redis'),
    meta  = require('../services/meta');

var getNextCardPosition = function(columnId, cb) {
  Column.findOne({id: columnId}).populate('cards').exec(function(err, column) {
    if (err) return cb(err);

    var max = 0;

    column.cards.forEach(function(c) {
      if (c.position > max) max = c.position;
    });

    cb(null, max + 1);
  });
};

module.exports = {

  create: function(req, res) {
    var user     = req.user,
        boardId  = parseInt(req.param('boardId')),
        columnId = parseInt(req.param('columnId')),
        content  = (req.body.content || '');

    if (!boardId || !columnId) return res.badRequest('Invalid parameters.');

    getNextCardPosition(columnId, function(err, nextpos) {
      if (err) return res.serverError(err);

      var attributes = {
        creator:  user.id,
        content:  content,
        position: nextpos,
        column:   columnId
      };

      Card.create(attributes, function(err, card) {
        if (err) return res.serverError(err);

        res.jsonx(card);

        redis.cardCreated(boardId, card, req);
      });
    });
  },

  update: function(req, res) {
    var boardId  = parseInt(req.param('boardId')),
        columnId = parseInt(req.param('columnId')),
        cardId   = parseInt(req.param('cardId')),
        content  = (req.body.content || '').trim(),
        bits;

    if (!boardId || !columnId || !cardId) {
      return res.badRequest('Invalid parameters.');
    } else if (meta.cardLockedBySomeoneElse(boardId, cardId, req)) {
      return req.badRequest('Card is locked by another user.');
    }

    bits = {
      content: content
    };

    async.auto({
      stack:  function(cb) { Card.find({column: columnId}).sort({position: 'asc'}).exec(cb); },
      column: function(cb) { Column.findOneById(columnId).exec(cb); }
    }, function(err, r) {

      // If the card is in the trash and it is going to be empty, delete it!
      if (r.column.position === 0 && !content) {

        var stack       = util.normalizeCardStack(r.stack),
            originalMap = util.toCardStackMap(stack),
            jobs        = util.fixCardPositions(stack, originalMap);

        jobs.push(function(cb) { Card.destroy({id: cardId}).exec(cb); });

        async.parallel(jobs, function(err, results) {
          if (err) return res.serverError(err);

          meta.releaseCardLock(boardId, cardId, req);

          res.jsonx(null);

          redis.cardVaporize(boardId, cardId, req);
        });

      } else {  // Normal card update...

        Card.update(cardId, bits).populate('votes').exec(function(err, card) {
          if (err) return res.serverError(err);

          card = card[0];

          meta.releaseCardLock(boardId, cardId, req);

          res.jsonx(card);

          redis.cardUpdated(boardId, card, req);
        });
      }

    })
  },

  upvote: function(req, res) {
    var user     = req.user,
        boardId  = parseInt(req.param('boardId')),
        columnId = parseInt(req.param('columnId')),
        cardId   = parseInt(req.param('cardId'));

    // FIXME: especially when we implement permissions, be sure and revisit ensuring
    //        that the card belongs to the column, which belongs to be board that we
    //        expect! Also, check this sort of thing with the other methods.

    if (!boardId || !columnId || !cardId) return res.badRequest('Invalid parameters.');

    // Let's make sure they haven't voted too much. This probably could be faster...
    Board.loadFullById(boardId, function(err, board) {
      if (err) return res.serverError(err);

      var cool = false;

      if (board.votesPerUser === -1) {  // no vote limit
        cool = true;

      } else {
        var votesRemaining = board.votesPerUser;

        board.columns.forEach(function(column) {
          column.cards.forEach(function(card) {
            card.votes.forEach(function(v) {
              if (v.user === user.id) votesRemaining--;
            });
          });
        });

        cool = votesRemaining > 0;
      }

      if (!cool) return res.badRequest("You're out of votes!");

      Card.findOneById(cardId).populate('votes').exec(function(err, card) {
        if (err) return res.serverError(err);

        if (!card) return res.badRequest('Card does not exist!');

        Vote.create({user: user.id, card: card.id}, function(err, vote) {
          if (err) return res.serverError(res);

          res.jsonx(vote);

          redis.cardUpvote(boardId, vote);
        });
      });
    });
  },

  lock: function(req, res) {
    var boardId = parseInt(req.param('id')),
        cardId  = parseInt(req.param('cardId'));

    if (!boardId || !cardId) return res.badRequest('Invalid parameters.');

    util.getCardAndBoard(cardId, boardId, req, res, function(r) {
      if (!r) return;

      var gotLock = meta.getCardLock(boardId, cardId, req);

      if (!gotLock) return res.jsonx(false);  // srybro, card is already locked !

      res.jsonx(true);
    });
  },

  unlock: function(req, res) {
    var boardId = parseInt(req.param('id')),
        cardId  = parseInt(req.param('cardId'));

    if (!boardId || !cardId) return res.badRequest('Invalid parameters.');

    util.getCardAndBoard(cardId, boardId, req, res, function(r) {
      if (!r) return;

      var successfulRelease = meta.releaseCardLock(boardId, cardId, req);

      if (!successfulRelease) return res.jsonx(false);

      res.jsonx(true);
    });
  },

  color: function(req, res) {
    var boardId  = parseInt(req.param('boardId')),
        columnId = parseInt(req.param('columnId')),
        cardId   = parseInt(req.param('cardId')),
        color    = req.body.color;

    if (!boardId || !columnId || !cardId || !color) return res.badRequest('Invalid parameters.');

    async.auto({
      board:  function(cb) { Board.findOneById(boardId).exec(cb); },
      column: function(cb) { Column.find({id: columnId, board: boardId}).exec(cb); },
      card:   function(cb) { Card.find({id: cardId, column: columnId}).exec(cb); }
    }, function(err, r) {
      if (err)                              return res.serverError(err);
      if (!r.board || !r.column || !r.card) return res.notFound();

      var card = r.card[0];

      card.color = color;

      card.save(function(err, c) {
        if (err) return res.serverError(err);

        res.jsonx(c);

        redis.cardColor(boardId, {id: cardId, color: color});
      });
    });

  }

};


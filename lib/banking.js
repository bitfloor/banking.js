// builtin
var https = require('https');
var urlparse = require('url').parse;

// vendor
var ofx = require('ofx');

var uuid = require('./uuid');

module.exports = function(opt) {
  return new Bank(opt);
};

var Bank = function(opt) {
  var self = this;
  self.opt = opt;
};

Bank.prototype._header = function() {
  var header = {
    OFXHEADER: '100',
    DATA: 'OFXSGML',
    VERSION: '103',
    SECURITY: 'NONE',
    ENCODING: 'USASCII',
    CHARSET: '1252',
    COMPRESSION: 'NONE',
    OLDFILEUID: 'NONE',
    NEWFILEUID: uuid(32)
  };

  return header;
};

Bank.prototype.getAccounts = function(cb) {
  var self = this;

  var header = self._header();
  var body = {
    SIGNONMSGSRQV1: {
      SONRQ: {
        DTCLIENT: o.date_end,
        USERID: o.user,
        USERPASS: o.pass,
        LANGUAGE: 'ENG',
        FI: {
          ORG: o.fidorg,
          FID: o.fid
        },
        APPID: 'QWIN',
        APPVER: '2100'
      }
    },
    SIGNUPMSGSRQV1: {
      ACCTINFOTRNRQ: {
        TRNUID: uuid(32),
        ACCTINFORQ: {
          DTACCTUP: '20121201'
        }
      }
    }
  };

  var ofxReq = ofx.serialize(header, body);
};

Bank.prototype.getStatement = function(cb) {
  var self = this;
  var params = self.opt;
  //opt = opt || {};

  var header = self._header();
  var body = {
    SIGNONMSGSRQV1: {
      SONRQ: {
        DTCLIENT: params.date_end,
        USERID: params.user,
        USERPASS: params.pass,
        LANGUAGE: 'ENG',
        FI: {
          ORG: params.fidorg,
          FID: params.fid
        },
        APPID: 'QWIN',
        APPVER: '2100'
      }
    },
    BANKMSGSRQV1: {
      STMTTRNRQ: {
        TRNUID: uuid(32),
        CLTCOOKIE: uuid(5),
        STMTRQ: {
          BANKACCTFROM: {
            BANKID: params.bankid,
            ACCTID: params.accid,
            ACCTTYPE: params.acctype
          },
          INCTRAN: {
            DTSTART: params.date_start,
            INCLUDE: 'Y'
          }
        }
      }
    }
  };

  var ofxReq = ofx.serialize(header, body);

  self._request(ofxReq, function(err, body) {
    if (err) {
      return cb(err);
    }

    try {
      var data = processTransactions(ofx.parse(body));
      data.raw = body;

      // capture an error if there was one
      if (data.OFX && data.OFX.SIGNONMSGSRSV1 && data.OFX.SIGNONMSGSRSV1.SONRS) {
        var status = data.OFX.SIGNONMSGSRSV1.SONRS.STATUS;
        if (status.SEVERITY === 'ERROR') {
          var err = new Error(status.MESSAGE);
          err.code = status.CODE;
          return cb(err);
        }
      }

      cb(null, data);
    }
    catch (err) {
      err.raw_ofx = body;
      cb(err);
    }
  });
};

Bank.prototype._request = function(body, cb) {
  var self = this;

  var url = urlparse(self.opt.url);

  var opt = {
    method: 'POST',
    host: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type' : 'application/x-ofx',
      'Content-Length': body.length
    }
  };

  var req = https.request(opt, function(res) {
    var body = '';

    var type = res.headers['content-type'];
    if (type !== 'application/x-ofx' && type !== 'plain/text') {
      return cb(new Error('Expected: application/x-ofx or plain/text, ' +
                          'Received: ' + type));
    };

    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('error', cb);

    res.on('end', function() {
      cb(null, body);
    });
  });

  req.end(body);
  req.on('error', cb);
};

var processTransactions = function(data) {
    // loop through all of the statement transactions
    var saveTransactions = [];
    if ( data.OFX
         && data.OFX.BANKMSGSRSV1
         && data.OFX.BANKMSGSRSV1.STMTTRNRS
         && data.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS
         && data.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS.BANKTRANLIST
         && data.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS.BANKTRANLIST.STMTTRN
       ) {

        // save some other metadata
        var meta = data.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS.BANKACCTFROM;
        data.meta = {
            accountId: String(meta.ACCTID),
            bankId: String(meta.BANKID),
            branchId: String(meta.BRANCHID),
            accountType: String(meta.ACCTTYPE)
        };

        var transactions = data.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS.BANKTRANLIST.STMTTRN;
        transactions.forEach(function(tran) {
            var transaction = {
                amount : tran.TRNAMT,
                date : tran.DTPOSTED,
                type : tran.TRNTYPE,
                fitid : String(tran.FITID),
                name : tran.NAME,
                memo : tran.MEMO
            };
            saveTransactions.push(transaction);
        });
    }

    data.transactions = saveTransactions;
    return data;
};


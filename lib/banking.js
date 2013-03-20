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

  if (!opt.clientuid) {
    throw new Error('clientuid must be specified');
  }
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

  var params = self.opt;
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
        APPVER: '2100',
        CLIENTUID: params.clientuid
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

  self._request(ofxReq, function(err, body) {
    if (err) {
      return cb(err);
    }

    try {
      var data = ofx.parse(body);
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
        APPVER: '2100',
        CLIENTUID: params.clientuid
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
      var parsed = ofx.parse(body);

      // capture an error if there was one
      if (parsed.OFX && parsed.OFX.SIGNONMSGSRSV1 && parsed.OFX.SIGNONMSGSRSV1.SONRS) {
        var status = parsed.OFX.SIGNONMSGSRSV1.SONRS.STATUS;
        if (status.SEVERITY === 'ERROR') {
          var err = new Error(status.MESSAGE);
          err.code = status.CODE;
          return cb(err);
        }
      }

      var res = processAccount(parsed);
      res.raw = body;

      cb(null, res);
    }
    catch (err) {
      err.raw = body;
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

var processAccount = function(data) {
  var account = {};

  if (!data.OFX || !data.OFX.BANKMSGSRSV1 || !data.OFX.BANKMSGSRSV1.STMTTRNRS) {
    return accounts;
  }

  var details = data.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS;

  account.currency = details.CURDEF;
  account.routing = details.BANKACCTFROM.BANKID;
  account.number = details.BANKACCTFROM.ACCTID;
  account.type = details.BANKACCTFROM.ACCTTYPE;
  account.balance = {
    ledger: details.LEDGERBAL.BALAMT - 0,
    available: details.LEDGERBAL.BALAMT - 0
  };

  var transactions = account.transactions = [];

  if (details.BANKTRANLIST && details.BANKTRANLIST.STMTTRN) {
    var tx_raw = details.BANKTRANLIST.STMTTRN;
    tx_raw.forEach(function(tran) {
      transactions.push({
        amount : tran.TRNAMT,
        date : tran.DTPOSTED,
        type : tran.TRNTYPE,
        fitid : String(tran.FITID),
        name : tran.NAME,
        memo : tran.MEMO
      });
    });
  }

  return account;
};

